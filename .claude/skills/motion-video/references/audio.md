# 聲音

聲音要在動畫之前定案，因為旁白的長度決定了整條時間軸。

## 旁白來源

| 語言 | provider     | 預設模型                 | 密鑰                 |
| ---- | ------------ | ------------------------ | -------------------- |
| 中文 | `minimax`    | `speech-2.8-hd`          | `MINIMAX_API_KEY`    |
| 英文 | `elevenlabs` | `eleven_multilingual_v2` | `ELEVENLABS_API_KEY` |

- ElevenLabs 的中文發音不自然，中文一律用 MiniMax
- 使用者自己錄音時，用 `npx hyperframes transcribe` 轉出時間碼
- Kokoro（`npx hyperframes tts`）只用來試排時間軸，不出正式版

## voiceover.json

中文範例：

```json
{
  "provider": "minimax",
  "voice_id": "Chinese_casual_instructor_nv1",
  "model_id": "speech-2.8-hd",
  "language_boost": "Chinese",
  "output_dir": "9x16/assets/audio/vo",
  "lines": [
    { "id": "s1-01", "text": "同一個問題，AI 為什麼每次回答都不一樣？" },
    { "id": "s2-01", "text": "因為它有一個旋鈕，叫做溫度。" }
  ]
}
```

英文改成 `"provider": "elevenlabs"`、ElevenLabs 的 `voice_id`，可加 `"voice_settings": { "stability": 0.5, "similarity_boost": 0.75 }`。MiniMax 的 `voice_settings` 對應它的 `speed`、`vol`、`pitch`、`emotion`。

- `output_dir` 相對於 `voiceover.json`，指向主比例專案；其他比例由 `retime.mjs` 自動複製一份，因為 HyperFrames 的素材路徑不能跨出專案資料夾
- 同一個系列固定用同一組 provider、voice_id、model_id，寫進 BRIEF.md
- 一行一句。修改一句只會重新產生那一句

## 挑聲音

先列出候選，再用第一句旁白各產生一段試聽給使用者挑。試聽放在暫存資料夾，不放進專案。

- MiniMax：`POST https://api.minimax.io/v1/get_voice`，body `{"voice_type":"system"}`，用 `Mandarin` 篩選。描述都是標準普通話，沒有台灣口音；要台灣腔需要用 MiniMax 的聲音複製
- ElevenLabs：`GET https://api.elevenlabs.io/v2/voices`，API key 要有 `voices_read` 權限，沒有的話請使用者從網站複製 voice ID

## 從旁白到時間軸

1. `node scripts/tts.mjs video/voiceover.json`：每一行產出 `<id>.mp3` 和 `<id>.timing.json`（`{ hash, duration, chars: [{ c, start, end }] }`），以及依順序列出長度的 `index.json`。`hash` 沒變的行會跳過，不重新計費
2. `node scripts/vo-timeline.mjs video/voiceover.json --max 14`：排出各句開始時間和字幕分段，輸出 `timeline.json` 和可直接貼進 composition 的 `timeline.snippet.html`（音軌加字幕）。相鄰短句會合併，字幕才不會每半秒換一次
3. 把片段貼進 `index.html`，前後加上 `<!-- vo:begin -->`、`<!-- vo:end -->`，並在 script 開頭寫 `const VO = {...};`（各句開始時間與 `end`，值從 `timeline.json` 來）。動畫時間一律寫成相對錨點，例如 `VO["s3-01"] + 0.2`
4. 旁白之後有改（換聲音、改稿），重跑步驟 1、2，再跑 `node scripts/retime.mjs video/voiceover.json video/9x16 video/16x9`：它會換掉 vo 區塊、更新 `VO`，並把其他元素的 `data-start`、`data-duration` 對到最近的錨點。例如換聲音後總長從 19.8 秒變成 16.8 秒，一個指令就改完

時間碼精度：ElevenLabs 是逐字；MiniMax 是逐詞，`tts.mjs` 會在詞內平均分配到每個字，字幕對齊足夠用。

## 密鑰

- 本機：環境變數，或 macOS 鑰匙圈裡同名的項目。使用者自己在終端機存：`security add-generic-password -a "$USER" -s MINIMAX_API_KEY -w`
- MiniMax 中國大陸帳號：設定 `MINIMAX_API_HOST=https://api.minimaxi.com`
- 雲端：session 不持有密鑰。推上 `voiceover.json` 後，JT-Projects 的 `tts` workflow 用 GitHub Secrets 產生音檔並 commit 回來
- 不要把密鑰寫進任何檔案、指令列參數或 commit
- MiniMax 回傳 `1008 insufficient balance` 是餘額不足，請使用者儲值；已完成的行會保留，重跑只補剩下的

## 音樂與音效

- 使用者沒提供音樂時，用 `/media-use` 找免授權音樂和音效，把授權資訊記在 `REVIEW.md`
- 旁白出現時，音樂壓低約 10–14 dB（HyperFrames 的混音設定）
- 交片響度：整體 -14 LUFS，峰值 -1 dBTP，是 YouTube、IG、TikTok 的常見正規化目標。`render-all.sh` 會自動做兩段式 loudnorm，只處理音軌，不重新編碼影像。例如原始 -22.8 LUFS，處理後 -14.1
- 只能量，不能聽，回覆時要說明
