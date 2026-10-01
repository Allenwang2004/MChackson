# CM Detector

Chrome 擴充功能。在網頁上的圖片、音訊或影片按右鍵，選 "Check for deepfake"，
會打開 Chrome 側邊面板顯示偽造機率。面板會一直開著並保留本次瀏覽工作階段的偵測紀錄。

有些網站的播放器會攔下右鍵選單（例如 X、YouTube），這時把滑鼠移到媒體上按快捷鍵
Alt+Shift+D（Mac 為 Option+Shift+D），會偵測游標底下的媒體。快捷鍵可在
`chrome://extensions/shortcuts` 修改；若與其他擴充衝突，Chrome 不會自動指派，需要在該頁手動設定。

## 運作流程

1. 取得媒體：
   - 右鍵直接點在有實際網址的圖片、音訊、影片上：background 以使用者的登入狀態下載（`srcUrl`）
   - 其他情況（媒體上蓋了透明圖層，或是 `blob:` 串流，例如 Instagram）：content script 以
     `elementsFromPoint` 找出右鍵位置底下的媒體，有網址就下載，沒有就用 `captureStream()` 錄製 6 秒（webm）
2. 以檔案上傳到 CM 後端 `http://localhost:4000/upload`，並附上 `kind`（image / audio / video）
3. 後端處理：
   - 圖片：送到 `localhost:3000/inference`（image_detector 的 UnivFD 服務）
   - 音訊：用 ffmpeg 轉成 16 kHz 單聲道 wav，送到 `localhost:8085/spoof_detector`（audio_detector）
   - 影片：音軌送語音模型，另抽 4 張畫面送圖片模型，取兩者中較高的偽造機率
4. 後端回傳 `fake_probability`（0 到 1），0.5 以上判定為偽造，結果寫入 `chrome.storage.session`，側邊面板即時更新

## 開發

需要先啟動 CM 後端（`node app.js`）以及上述兩個偵測服務；沒有模型時可用 `local_test/`。

```bash
pnpm install
pnpm dev      # 開發模式，輸出到 build/chrome-mv3-dev
pnpm build    # 正式版，輸出到 build/chrome-mv3-prod
```

在 `chrome://extensions` 開啟開發人員模式，選「載入未封裝項目」，指向上述 build 資料夾。

## 已知限制

- 串流影片需要正在播放才錄得到內容，錄製長度由 `lib/types.ts` 的 `RECORD_SECONDS` 設定
- 有 DRM 保護的影片（例如 Netflix）無法錄製
- 安裝或重新載入擴充後，已開啟的分頁要重新整理，才能偵測透明圖層底下或串流的媒體
- 偵測紀錄只保留到瀏覽器關閉，最多 50 筆
