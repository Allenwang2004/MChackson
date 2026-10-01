import type { PlasmoCSConfig } from "plasmo"

import type {
  CaptureRequest,
  LocateResponse,
  MediaKind,
  PointerMessage,
  RecordResponse
} from "~lib/types"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true
}

type MediaElement = HTMLImageElement | HTMLVideoElement | HTMLAudioElement

const THUMBNAIL_WIDTH = 160
// 回報游標所在 frame 的最短間隔
const POINTER_REPORT_INTERVAL_MS = 500

// 最近一次右鍵位置底下的媒體元素
let contextTarget: MediaElement | null = null
// 目前游標位置，供快捷鍵使用
let pointer: { x: number; y: number } | null = null
let lastPointerReport = 0
// 已定位過的元素，重試時可以再錄一次
const targets = new Map<string, MediaElement>()

// 網站常在影片上蓋透明圖層或封面圖（例如 Instagram、X），用 elementsFromPoint 穿透找到底下的媒體。
// 同一位置同時有圖片與影音時，以影音為準，避免抓到影片的封面圖
function findMediaAt(x: number, y: number): MediaElement | null {
  const elements = document.elementsFromPoint(x, y)
  return (
    (elements.find(
      (el) => el instanceof HTMLVideoElement || el instanceof HTMLAudioElement
    ) as MediaElement | undefined) ??
    (elements.find((el) => el instanceof HTMLImageElement) as MediaElement | undefined) ??
    null
  )
}

window.addEventListener(
  "contextmenu",
  (event) => {
    contextTarget = findMediaAt(event.clientX, event.clientY)
  },
  true
)

// 有些播放器（例如 X、YouTube）會攔下右鍵選單，改用快捷鍵偵測游標底下的媒體
window.addEventListener(
  "pointermove",
  (event) => {
    pointer = { x: event.clientX, y: event.clientY }
    const now = Date.now()
    if (now - lastPointerReport > POINTER_REPORT_INTERVAL_MS) {
      lastPointerReport = now
      chrome.runtime.sendMessage<PointerMessage>({ type: "cm:pointer" }).catch(() => {})
    }
  },
  { capture: true, passive: true }
)

chrome.runtime.onMessage.addListener((message: CaptureRequest, _sender, sendResponse) => {
  if (message?.type === "cm:locate") {
    const el =
      message.at === "pointer" ? (pointer ? findMediaAt(pointer.x, pointer.y) : null) : contextTarget
    sendResponse(locate(el))
    return
  }
  if (message?.type === "cm:record") {
    record(message.captureId, message.seconds).then(sendResponse)
    // 非同步回應
    return true
  }
})

function locate(el: MediaElement | null): LocateResponse {
  if (!el) return { found: false }

  const captureId = crypto.randomUUID()
  targets.set(captureId, el)

  if (el instanceof HTMLImageElement) {
    return { found: true, kind: "image", url: el.currentSrc || el.src, captureId }
  }

  const kind: MediaKind = el instanceof HTMLVideoElement ? "video" : "audio"
  const src = el.currentSrc || el.src
  // 有實際檔案網址就直接下載；blob: 或 MediaSource 串流只能錄製
  const url = src && /^https?:/.test(src) ? src : undefined
  return { found: true, kind, url, captureId, thumbnail: grabThumbnail(el) }
}

function grabThumbnail(el: HTMLVideoElement | HTMLAudioElement): string | undefined {
  if (!(el instanceof HTMLVideoElement) || !el.videoWidth) return undefined
  try {
    const canvas = document.createElement("canvas")
    canvas.width = THUMBNAIL_WIDTH
    canvas.height = Math.round((THUMBNAIL_WIDTH * el.videoHeight) / el.videoWidth)
    canvas.getContext("2d")!.drawImage(el, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.7)
  } catch {
    // 跨來源影片會讓 canvas 無法讀取，略過縮圖
    return undefined
  }
}

async function record(captureId: string, seconds: number): Promise<RecordResponse> {
  const el = targets.get(captureId)
  if (!el || el instanceof HTMLImageElement || !el.isConnected) {
    return { ok: false, error: "The media is no longer on the page. Right-click it again." }
  }

  let stream: MediaStream
  try {
    stream = (el as HTMLMediaElement & { captureStream(): MediaStream }).captureStream()
  } catch {
    return { ok: false, error: "This media is protected and cannot be captured." }
  }

  const hasVideo = stream.getVideoTracks().length > 0
  const hasAudio = stream.getAudioTracks().length > 0
  if (!hasVideo && !hasAudio) {
    return { ok: false, error: "No playable audio or video. Start playback and try again." }
  }

  const mimeType = pickMimeType(hasVideo, hasAudio)
  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }

  const stopped = new Promise((resolve) => (recorder.onstop = resolve))
  recorder.start(1000)
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  recorder.stop()
  await stopped
  stream.getTracks().forEach((t) => t.stop())

  const blob = new Blob(chunks, { type: mimeType })
  if (!blob.size) {
    return { ok: false, error: "Nothing was recorded. Start playback and try again." }
  }
  return { ok: true, data: await toBase64(blob), mimeType: mimeType.split(";")[0] }
}

function pickMimeType(hasVideo: boolean, hasAudio: boolean) {
  const candidates = hasVideo
    ? [hasAudio ? "video/webm;codecs=vp8,opus" : "video/webm;codecs=vp8", "video/webm"]
    : ["audio/webm;codecs=opus", "audio/webm"]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? candidates.at(-1)!
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // MIME 本身可能含逗號（例如 codecs=vp8,opus），以 "base64," 為界取資料
      const url = reader.result as string
      resolve(url.slice(url.indexOf(";base64,") + ";base64,".length))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
