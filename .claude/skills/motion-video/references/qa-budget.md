# 自檢預算

原則：先跑不花看圖 token 的檢查，前一層沒過就不往下跑。數字和眼睛的判斷有衝突時，以數字為準，因為出界幾個像素、只停留 0.6 秒的字幕，在總表上看起來都沒問題。

## 分層

| 層 | 指令 | 什麼時候跑 | 看圖 |
|---|---|---|---|
| L0 | `scripts/qa.sh <dir> --lint-only` | 每次修改後 | 不看 |
| L1 | `scripts/qa.sh <dir>`（lint、check，加上安全區） | 每完成一個場景或一章 | 不看 |
| L2 | `npx hyperframes snapshot --review`，只看 `review-beats-*.jpg` | 短片：L1 通過後；長片：每章完成時跑一次，之後只跑有改動的章 | 1–2 張 |
| L3 | `npx hyperframes snapshot --at A,B` 或 `--range A,B --frames 8` | 只針對 L2 標出的問題，或修改過的時間點 | 先用 ffmpeg 縮小再看 |
| L4 | 另開 subagent 審片 | 交片前一次 | 不佔主對話 |

## L2 怎麼看

`snapshot --review` 會在 `.hyperframes/artifacts/snapshots/<id>/` 產生很多張圖：`review-beats-*`（每個段落的關鍵畫格）、`review-seam-*`（每個剪接點前後）、`review-phone-*`（手機寬度）。預設只看 `review-beats-*`；剪接點有疑慮才看 seam，字很小才看 phone。不要加 `--json`，它的輸出有好幾十 KB，用 `ls` 找圖就好。

看圖前用 `ffmpeg -i in.jpg -vf scale=900:-1 out.jpg` 縮小，看構圖和節奏不需要原尺寸。

照 `/hyperframes` 的 `references/review.md`，問題一行一條：

```
t=4.2s · 標題 · 和背景對比太低 → 標題改成 #FFFFFF · 保留進場動畫
```

分三級：P0 看不懂、錯誤、壞掉；P1 削弱效果；P2 細節。

## L4 subagent

只給它 `STORYBOARD.md`、`FRAME.md` 和 L2 的 `review-beats-*` 路徑，請它只回 P0 和 P1，用上面的格式。不給它對話紀錄和程式碼，因為它的價值在於像第一次看的觀眾。

## 停止規則

- 修完所有 P0，加上值得花時間的 P1；P2 列在 REVIEW.md 就好
- 修改順序：文字 → 時間 → 細節
- 修完只對改過的地方跑 L3，不重跑整份 L2
- **最多修兩輪**。兩輪後還有 P0，停下來回報給使用者，附上問題清單和建議做法，不要無限迭代
- 不要給影片打分數，分數找不出問題

## 長片的預算

12 分鐘的影片如果每輪都跑完整 L2，看圖成本會是短片的十幾倍。所以：

- L2 以章為單位，每章最多兩次（完成時一次、修改後一次）
- L4 只看整支影片的關鍵畫格，不看每一章的完整總表
