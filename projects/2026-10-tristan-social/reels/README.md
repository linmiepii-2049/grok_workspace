# Tristan Reels

字卡短影音（9:16）。每集只寫 `episode.json`，畫面由 `kit/` 的元件組成。

## 系列預設（2026-10-29 第 1 支定案）

- 旁白：MiniMax `Chinese_casual_instructor_nv1`、`speech-2.8-hd`，`voice_settings.speed: 1.2`
- 句間停頓 0.18 秒（`vo-timeline.mjs --gap 0.18`）；片尾 CTA 停 2 秒
- 不放背景音樂，只有內建音效
- 長度約 35～40 秒

## 一集的資料夾

| 檔案              | 內容                                              |
| ----------------- | ------------------------------------------------- |
| `BRIEF.md`        | 需求                                              |
| `STORYBOARD.md`   | 分鏡                                              |
| `voiceover.json`  | 旁白稿，一行一句，id 給 episode.json 對時間用     |
| `episode.json`    | 這集用哪些場景元件、填什麼內容、對到哪句旁白      |
| `9x16/`           | build.mjs 產生的 HyperFrames 專案，不要手改       |

## 流程

1. 寫 `voiceover.json` 和 `episode.json`
2. `node reels/kit/build.mjs reels/<集>`：沒有旁白時用字數估算時間，先看畫面
3. 推上 `voiceover.json`，GitHub Actions 的 `tts` workflow 產生旁白並 commit 回來；`git pull --rebase`
4. `node .claude/skills/motion-video/scripts/vo-timeline.mjs <集>/voiceover.json --max 14 --gap 0.18`，再跑一次 build.mjs，動畫自動對齊真實旁白
5. 自檢照 motion-video skill（`qa.sh <集>/9x16`、`snapshot --review`）
6. 正式版：觸發 GitHub Actions 的 `render` workflow（雲端 session 沒有 Cloudflare 密鑰，不在 session 內渲染歸檔），輸入
   - `dir`：`projects/2026-10-tristan-social/reels/<集>/9x16`
   - `output`：`projects/2026-10-tristan-social/outputs/video/reels-<集>-9x16.mp4`

   它會渲染、調到 -14 LUFS、歸檔到 R2，再把 `.r2.json` commit 回來；`git pull --rebase` 拉回來即可

## 場景元件（`kit/scenes/`）

| 元件           | 用途                                       | 主要欄位                                    |
| -------------- | ------------------------------------------ | ------------------------------------------- |
| `hook-canned`  | 鉤子：太短的 Prompt 換來罐頭回覆，蓋章劃掉 | prompt、reply、stamp、title                 |
| `equation`     | 比喻等式 A ＝ B，下面排出空標籤槽          | top、bottom、slots                          |
| `prompt-build` | Prompt 逐段長出來，回覆卡一版一版改寫      | rows（tag、text、line、at；同句兩段用 tagAt、until）、replies |
| `before-after` | 前後對比加大數字                           | before、after、stats（pre、num、post、at）  |
| `pick-edit`    | 人的判斷：圈選一版、改一句，接大標         | a、b（`[[要改的句子]]`）、fix、title        |
| `end-card`     | 片尾 CTA：形象照、帳號、留言關鍵字         | title、sub                                  |
| `comment-wall` | 互動鉤子：大標問題、留言彈進來、便利貼承諾 | title、comments（name、text、line、at）、note |
| `title-card`   | 轉場大標：小字引言＋大標                   | kicker、title                               |
| `sort-split`   | 人的判斷：卡片分成左右兩欄                 | left、right（head、at、items）、title       |

- 時間欄位都寫成「旁白裡的某個詞」（例如 `"titleAt": "問題"`），build.mjs 換算成秒數；換聲音、改稿都不用手改時間
- `**重點**` 會變成磚紅強調色；每個畫面只用一處
- 新元件：在 `kit/scenes/` 加一個檔案，動態只用 `kit/lib.mjs` 的 `mv`（打字、遮罩揭開、手繪線、蓋章、彈出、數字跳動），不要每集重寫 GSAP

## 品牌層（`kit/brand.css`、build.mjs）

- 配色同輪播 `beige-teal`；灰綠文字用 `--teal-ink`、白字底用 `--teal-deep`，原色對比不足
- 上方系列標（代表字＋英文＋編號）、下方字幕、最下方杏橘斜紋與灰綠圓點裝飾，每集固定
- 1330px 以下只放裝飾，避開各平台的按鈕和說明文字
