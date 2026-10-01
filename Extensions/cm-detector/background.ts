import {
  BACKEND_URL,
  HISTORY_KEY,
  RECORD_SECONDS,
  type CaptureRequest,
  type CaptureTarget,
  type DetectionResult,
  type HistoryEntry,
  type LocateResponse,
  type MediaKind,
  type PanelMessage,
  type PointerMessage,
  type RecordResponse
} from "~lib/types"

const REQUEST_TIMEOUT_MS = 120_000
const MAX_HISTORY = 50

// 後端依副檔名辨識格式，這裡把 MIME 對應到副檔名
const IMAGE_EXTS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp"
}

const AV_EXTS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogg",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv"
}

const MENU_ID = "cm-detect"

// 多個偵測同時進行時，依序寫入避免互相覆蓋
let writeQueue = Promise.resolve()

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Check for deepfake",
      // 包含 page 與 link：網站常在影片上蓋透明圖層或連結，右鍵點到的不是 <video> 本身
      contexts: ["image", "audio", "video", "page", "frame", "link"]
    })
  })
  // 點擊工具列圖示也能打開側邊面板
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

// Service worker 重新啟動時，先前未完成的偵測已中斷
void updateHistory((entries) =>
  entries.map((e) =>
    e.status === "pending"
      ? { ...e, status: "error", error: "Interrupted. Please retry." }
      : e
  )
)

// 各分頁中游標目前所在的 frame，供快捷鍵使用
const pointerFrames = new Map<number, number>()

chrome.tabs.onRemoved.addListener((tabId) => pointerFrames.delete(tabId))

// sidePanel.open 必須在使用者操作的同步流程中呼叫；開啟失敗不影響偵測
function openSidePanel(windowId: number) {
  try {
    chrome.sidePanel
      .open({ windowId })
      .catch((err) => console.warn("[cm-detector] cannot open side panel:", err.message))
  } catch (err) {
    console.warn("[cm-detector] cannot open side panel:", (err as Error).message)
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return
  openSidePanel(tab.windowId)
  void handleClick(info, tab)
})

// 快捷鍵：偵測游標底下的媒體（網站攔下右鍵選單時使用）
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "check-media" || !tab?.id) return
  openSidePanel(tab.windowId)
  void locateAndDetect(tab, pointerFrames.get(tab.id) ?? 0, "pointer")
})

chrome.runtime.onMessage.addListener((message: PanelMessage | PointerMessage, sender) => {
  if (message?.type === "cm:pointer") {
    if (sender.tab?.id !== undefined && sender.frameId !== undefined) {
      pointerFrames.set(sender.tab.id, sender.frameId)
    }
    return
  }
  if (message?.type !== "cm:retry") return
  void (async () => {
    const entries = await readHistory()
    const entry = entries.find((e) => e.id === message.id)
    if (!entry) return
    await patchEntry(entry.id, { status: "pending", error: undefined, result: undefined })
    await detect(entry)
  })()
})

async function handleClick(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab) {
  const mediaType = info.mediaType as MediaKind | undefined

  // 右鍵直接點在有實際網址的媒體上，直接下載
  if (mediaType && info.srcUrl && /^(https?|data):/.test(info.srcUrl)) {
    return addAndDetect({
      ...newEntryBase(tab),
      kind: mediaType,
      srcUrl: info.srcUrl,
      status: "pending"
    })
  }

  // 其他情況請 content script 找出右鍵位置底下的媒體
  await locateAndDetect(tab, info.frameId ?? 0, "contextmenu", mediaType)
}

function newEntryBase(tab: chrome.tabs.Tab) {
  return {
    id: crypto.randomUUID(),
    pageUrl: tab.url,
    pageTitle: tab.title,
    createdAt: Date.now()
  }
}

async function locateAndDetect(
  tab: chrome.tabs.Tab,
  frameId: number,
  at: "contextmenu" | "pointer",
  mediaType?: MediaKind
) {
  const base = newEntryBase(tab)
  let located: LocateResponse | undefined
  try {
    located = await chrome.tabs.sendMessage<CaptureRequest, LocateResponse>(
      tab.id!,
      { type: "cm:locate", at },
      { frameId }
    )
  } catch {
    located = undefined
  }

  if (!located?.found) {
    const where = at === "pointer" ? "under the mouse pointer" : "where you right-clicked"
    const error = located
      ? `No image, audio, or video found ${where}.`
      : "This page is not ready. Reload the page and try again."
    await updateHistory((entries) =>
      [{ ...base, kind: mediaType, srcUrl: tab.url ?? "", status: "error" as const, error }, ...entries].slice(0, MAX_HISTORY)
    )
    return
  }

  const capture = located.url
    ? undefined
    : { tabId: tab.id!, frameId, captureId: located.captureId }
  await addAndDetect({
    ...base,
    kind: located.kind,
    srcUrl: located.url ?? tab.url ?? "",
    thumbnail: located.thumbnail,
    capture,
    status: "pending"
  })
}

async function addAndDetect(entry: HistoryEntry) {
  await updateHistory((entries) => [entry, ...entries].slice(0, MAX_HISTORY))
  await detect(entry)
}

async function detect(entry: HistoryEntry) {
  try {
    const kind = entry.kind!
    let file: File
    if (entry.capture) {
      file = await recordFromPage(entry.capture, kind)
    } else {
      file = await fetchMedia(kind, entry.srcUrl)
    }
    const result = await upload(file, kind)
    await patchEntry(entry.id, { status: "done", result })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error("[cm-detector]", error)
    await patchEntry(entry.id, { status: "error", error })
  }
}

async function recordFromPage(target: CaptureTarget, kind: MediaKind): Promise<File> {
  let res: RecordResponse | undefined
  try {
    res = await chrome.tabs.sendMessage<CaptureRequest, RecordResponse>(
      target.tabId,
      { type: "cm:record", captureId: target.captureId, seconds: RECORD_SECONDS },
      { frameId: target.frameId }
    )
  } catch {
    res = undefined
  }
  if (!res) throw new Error("The page was closed or reloaded. Right-click the media again.")
  if (res.ok === false) throw new Error(res.error)

  const bytes = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0))
  return new File([bytes], `${kind}.webm`, { type: res.mimeType })
}

async function fetchMedia(kind: MediaKind, srcUrl: string): Promise<File> {
  let res: Response
  try {
    res = await fetch(srcUrl, {
      credentials: "include",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch {
    throw new Error("Could not download the media from the page.")
  }
  if (!res.ok) throw new Error(`Could not download the media (HTTP ${res.status}).`)

  const blob = await res.blob()
  const mime = blob.type.split(";")[0].trim().toLowerCase()
  const ext =
    (kind === "image" ? IMAGE_EXTS[mime] : AV_EXTS[mime]) ?? extFromUrl(srcUrl)
  if (!ext) throw new Error(`Unsupported media type: ${mime || "unknown"}`)
  return new File([blob], `${kind}.${ext}`, { type: blob.type })
}

function extFromUrl(url: string): string | undefined {
  try {
    return new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  } catch {
    return undefined
  }
}

async function upload(file: File, kind: MediaKind): Promise<DetectionResult> {
  const form = new FormData()
  form.append("kind", kind)
  form.append("file", file)

  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}/upload`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch {
    throw new Error("Cannot reach the detection backend. Make sure it is running.")
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.error || `Backend returned HTTP ${res.status}.`)
  }
  if (typeof body?.fake_probability !== "number") {
    throw new Error("Unexpected response from the backend.")
  }
  return body as DetectionResult
}

async function readHistory(): Promise<HistoryEntry[]> {
  const data = await chrome.storage.session.get(HISTORY_KEY)
  return (data[HISTORY_KEY] as HistoryEntry[]) ?? []
}

function updateHistory(fn: (entries: HistoryEntry[]) => HistoryEntry[]) {
  writeQueue = writeQueue
    .then(async () => {
      const entries = await readHistory()
      await chrome.storage.session.set({ [HISTORY_KEY]: fn(entries) })
    })
    .catch((err) => console.error("[cm-detector] failed to save history", err))
  return writeQueue
}

function patchEntry(id: string, patch: Partial<HistoryEntry>) {
  return updateHistory((entries) =>
    entries.map((e) => (e.id === id ? { ...e, ...patch } : e))
  )
}
