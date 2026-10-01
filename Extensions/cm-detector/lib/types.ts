export type MediaKind = "image" | "audio" | "video"

export const BACKEND_URL = "http://localhost:4000"
export const HISTORY_KEY = "cm-history"

// 串流影片（blob: 來源）在網頁中錄製的秒數
export const RECORD_SECONDS = 6

// CM 後端 /upload 的回應
export interface DetectionResult {
  kind: MediaKind
  // 偽造機率，0 到 1
  fake_probability: number
  verdict: "fake" | "real"
  details: {
    image?: { fake_probability: number }
    audio?: { fake_probability: number; segment_probabilities?: number[] }
    frames?: { fake_probability: number; frame_probabilities: number[] }
  }
}

// 需要在網頁內錄製的媒體，記下位置以便重試
export interface CaptureTarget {
  tabId: number
  frameId: number
  captureId: string
}

export interface HistoryEntry {
  id: string
  kind?: MediaKind
  srcUrl: string
  pageUrl?: string
  pageTitle?: string
  thumbnail?: string
  capture?: CaptureTarget
  createdAt: number
  status: "pending" | "done" | "error"
  result?: DetectionResult
  error?: string
}

export type PanelMessage = { type: "cm:retry"; id: string }

// background 與 content script 之間的訊息
export type CaptureRequest =
  // at: 以最近一次右鍵位置或目前游標位置尋找媒體
  | { type: "cm:locate"; at: "contextmenu" | "pointer" }
  | { type: "cm:record"; captureId: string; seconds: number }

// content script 通知 background 游標目前在哪個 frame
export type PointerMessage = { type: "cm:pointer" }

export type LocateResponse =
  | { found: false }
  | {
      found: true
      kind: MediaKind
      // 可直接下載的網址；串流媒體則為 undefined，需要錄製
      url?: string
      captureId: string
      thumbnail?: string
    }

export type RecordResponse =
  | { ok: true; data: string; mimeType: string }
  | { ok: false; error: string }
