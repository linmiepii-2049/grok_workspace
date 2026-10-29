# 長片（3 分鐘以上，最長約 12 分鐘）

長片的成本在「改一點就要全部重來」。所以把長片切成章節，每章可以獨立修改、檢查、渲染。

## 結構

- 一章一個 sub-composition：`compositions/ch01-intro.html`、`compositions/ch02-xxx.html`
- 每章 1–2 分鐘。太長的章節，改一處就要重新檢查一大段
- `index.html` 只放各章的掛載點；音樂、旁白、字幕都放在各章裡面，讓每章能單獨渲染
- 章節之間用轉場接，轉場放在後一章的開頭

## 流程

1. ✅ 章節大綱：每章一行，寫標題、長度、重點、主要畫面。確認後才展開分鏡
2. 每章的口白寫在 `voiceover.json` 裡，`id` 用 `ch02-05` 這種格式，方便只重新產生某一章
3. 一次完成一章，走完實作和 L0、L1 自檢再做下一章
4. 全部完成後，每章各跑一次 L2，L4 只跑一次，見 `qa-budget.md`

## 渲染

`scripts/render-all.sh` 偵測到 `compositions/ch*.html` 時，會逐章渲染到 `<aspect>/.render/`，然後用 ffmpeg 接合：

- 只重新渲染原始檔比上次渲染新的章節
- 所有章節用相同的 fps 和品質設定，才能直接接合而不重新編碼
- 音樂跨章節時，每章開頭和結尾各淡入淡出 0.5 秒，接合處才不會突然切斷

## YouTube 用的附加檔

- 章節時間碼：`render-all.sh` 依各章長度輸出 `outputs/video/<名稱>-chapters.txt`，貼進 YouTube 說明欄
- 字幕檔：每章的字幕合併成一份 SRT，放在 `outputs/video/`
