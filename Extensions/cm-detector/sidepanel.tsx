import { useEffect, useState } from "react"

import {
  BACKEND_URL,
  HISTORY_KEY,
  type HistoryEntry,
  type MediaKind,
  type PanelMessage
} from "~lib/types"

import "./sidepanel.css"

const KIND_LABEL: Record<MediaKind, string> = {
  image: "Image",
  audio: "Audio",
  video: "Video"
}

const BACKEND_CHECK_INTERVAL_MS = 10_000

function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  useEffect(() => {
    chrome.storage.session.get(HISTORY_KEY).then((data) => {
      setEntries((data[HISTORY_KEY] as HistoryEntry[]) ?? [])
    })
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes[HISTORY_KEY]) {
        setEntries(changes[HISTORY_KEY].newValue ?? [])
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  return entries
}

function useBackendStatus() {
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    const check = () =>
      fetch(BACKEND_URL, { method: "HEAD", signal: AbortSignal.timeout(3000) })
        .then((res) => setOnline(res.ok))
        .catch(() => setOnline(false))
    check()
    const timer = setInterval(check, BACKEND_CHECK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  return online
}

function useShortcut() {
  const [shortcut, setShortcut] = useState<string | null>(null)

  useEffect(() => {
    chrome.commands.getAll().then((commands) => {
      setShortcut(commands.find((c) => c.name === "check-media")?.shortcut || null)
    })
  }, [])

  return shortcut
}

function SidePanel() {
  const entries = useHistory()
  const online = useBackendStatus()
  const shortcut = useShortcut()

  const clear = () => chrome.storage.session.set({ [HISTORY_KEY]: [] })

  return (
    <div className="panel">
      <header className="header">
        <div>
          <h1>Deepfake Detector</h1>
          <div className={`status ${online === false ? "offline" : online ? "online" : ""}`}>
            <span className="dot" />
            {online === null
              ? "Checking backend..."
              : online
                ? "Backend connected"
                : "Backend not reachable"}
          </div>
        </div>
        {entries.length > 0 && (
          <button className="link" onClick={clear}>
            Clear
          </button>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="empty">
          <p>No checks yet.</p>
          <p>
            Right-click an image, audio, or video on any page and choose{" "}
            <strong>Check for deepfake</strong>.
          </p>
          <p>
            If a site replaces the right-click menu (for example X or YouTube), hover over the
            media and press{" "}
            {shortcut ? (
              <kbd>{shortcut}</kbd>
            ) : (
              <>a shortcut you set at <strong>chrome://extensions/shortcuts</strong></>
            )}
            .
          </p>
        </div>
      ) : (
        <>
          {shortcut && (
            <p className="hint">
              Tip: hover over media and press <kbd>{shortcut}</kbd> to check it.
            </p>
          )}
          <ul className="list">
            {entries.map((entry) => (
              <ResultCard key={entry.id} entry={entry} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function ResultCard({ entry }: { entry: HistoryEntry }) {
  const retry = () => chrome.runtime.sendMessage<PanelMessage>({ type: "cm:retry", id: entry.id })

  let tone = "pending"
  if (entry.status === "error") tone = "error"
  if (entry.status === "done") tone = entry.result!.verdict === "fake" ? "fake" : "real"

  return (
    <li className={`card ${tone}`}>
      <div className="card-head">
        <Thumbnail entry={entry} />
        <div className="meta">
          <div className="kind">{kindLabel(entry)}</div>
          <a
            className="source"
            href={entry.srcUrl}
            target="_blank"
            rel="noreferrer"
            title={isLocalUrl(entry.srcUrl) ? undefined : entry.srcUrl}>
            {describeSource(entry)}
          </a>
          <div className="time">{new Date(entry.createdAt).toLocaleTimeString()}</div>
        </div>
      </div>

      {entry.status === "pending" && (
        <div className="body">
          <div className="verdict">Analyzing...</div>
          <div className="bar indeterminate">
            <div />
          </div>
        </div>
      )}

      {entry.status === "error" && (
        <div className="body">
          <div className="verdict">Check failed</div>
          <p className="error-text">{entry.error}</p>
          <button className="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}

      {entry.status === "done" && entry.result && <ResultBody entry={entry} />}
    </li>
  )
}

function ResultBody({ entry }: { entry: HistoryEntry }) {
  const { fake_probability, verdict, details } = entry.result!
  const breakdown: [string, number][] = []
  if (entry.kind === "video") {
    if (details.audio) breakdown.push(["Audio track", details.audio.fake_probability])
    if (details.frames) breakdown.push(["Video frames", details.frames.fake_probability])
  }

  return (
    <div className="body">
      <div className="verdict">{verdict === "fake" ? "Likely fake" : "Likely authentic"}</div>
      <div className="score">
        <span className="score-value">{percent(fake_probability)}</span>
        <span className="score-label">probability of being fake</span>
      </div>
      <div className="bar">
        <div style={{ width: percent(fake_probability) }} />
      </div>
      {breakdown.length > 0 && (
        <dl className="breakdown">
          {breakdown.map(([label, p]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{percent(p)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function Thumbnail({ entry }: { entry: HistoryEntry }) {
  const [failed, setFailed] = useState(false)
  const src = entry.thumbnail ?? (entry.kind === "image" ? entry.srcUrl : undefined)
  if (src && !failed) {
    return <img className="thumb" src={src} alt="" onError={() => setFailed(true)} />
  }
  return <div className="thumb placeholder">{kindLabel(entry)}</div>
}

function kindLabel(entry: HistoryEntry) {
  return entry.kind ? KIND_LABEL[entry.kind] : "Media"
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"]

function isLocalUrl(srcUrl: string) {
  try {
    return LOCAL_HOSTS.includes(new URL(srcUrl).hostname)
  } catch {
    return false
  }
}

// 本機網址只顯示檔名，其他網站顯示「網域 / 檔名」
function describeSource(entry: HistoryEntry) {
  try {
    const url = new URL(entry.srcUrl)
    if (url.protocol === "data:" || url.protocol === "blob:") return entry.pageTitle || "Embedded media"
    const file = url.pathname.split("/").filter(Boolean).pop()
    const name = file ? decodeURIComponent(file) : ""
    if (isLocalUrl(entry.srcUrl)) return name || entry.pageTitle || "Local file"
    return name ? `${url.hostname} / ${name}` : url.hostname
  } catch {
    return entry.pageTitle || "Unknown source"
  }
}

function percent(p: number) {
  return `${(p * 100).toFixed(1)}%`
}

export default SidePanel
