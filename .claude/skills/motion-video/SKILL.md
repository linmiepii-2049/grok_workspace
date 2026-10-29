---
name: motion-video
description: Turns a topic, script, or reference images into a polished code-driven video for social media and YouTube, either an explainer B-roll or a motion-graphics showcase from 15-second shorts to about 12-minute long-form, built with HyperFrames (HTML, GSAP, Three.js, p5.js), with Traditional Chinese captions, MiniMax (Chinese) or ElevenLabs (English) voiceover, music and SFX, self-checked in cost-ordered layers and archived to the JT-Projects outputs folder. Use whenever the user wants a video made or edited, e.g. 做影片、做動效片、解說影片、B-roll、短影音動畫、Reels 或 Shorts 動畫、YouTube 解說片、把這個主題做成影片、照這張參考圖的風格做動畫, or mentions Remotion, three.js, p5.js, motion graphics, or HyperFrames for video, even if they never say motion-video. Not for editing, trimming, or subtitling existing recorded footage.
---

# Motion Video

用 HyperFrames 把 HTML 渲染成影片。HyperFrames 自己的 skill 負責「怎麼寫、怎麼檢查」；這個 skill 只管它沒管的事：需求怎麼問、參考圖怎麼變風格、中文、旁白、長片、自檢預算與 JT 歸檔。兩者衝突時以這裡為準。

核心原則：**在最便宜的階段做決定**。改文字比改程式便宜，改程式比重新渲染便宜，所以每個決定都盡量在文字階段（需求、分鏡）定案，並且先鎖定聲音再做動畫。

## 需求

- 套件：Node 22+、ffmpeg、Chrome（HyperFrames 會自己下載 headless shell）
- HyperFrames：CLI 版本鎖在 JT-Projects 的 `package.json`，一律用 `npx hyperframes` 呼叫，才會用到鎖定的版本；skill 由 `.claude/settings.json` 啟用的 `hyperframes` plugin 提供。缺少時先跑 `scripts/preflight.sh`，照它的提示處理
- 環境變數：`MINIMAX_API_KEY`（中文旁白）、`ELEVENLABS_API_KEY`（英文旁白），都只在本機，雲端 session 不持有密鑰，見步驟 4；`HYPERFRAMES_NO_TELEMETRY=1`
- 外部網域：`api.minimax.io`、`api.elevenlabs.io`、`registry.npmjs.org`、`fonts.googleapis.com`、`fonts.gstatic.com`、`cdn.jsdelivr.net`（GSAP、three.js、p5.js）

## 專案位置

```
projects/<yyyy-mm>-<slug>/
├── video/
│   ├── BRIEF.md            需求（步驟 1）
│   ├── FRAME.md            風格（步驟 2）
│   ├── voiceover.json      旁白稿（步驟 4）
│   └── <aspect>/           一個比例一個 HyperFrames 專案，例如 9x16/、16x9/
│       ├── index.html
│       ├── compositions/
│       ├── assets/         字型、圖片、audio/vo/*.mp3
│       ├── STORYBOARD.md
│       └── REVIEW.md
└── outputs/video/          成品 mp4，只有這裡會被歸檔
```

專案不存在時先用 `npm run jt -- new <slug> "<名稱>"` 建立。新的 HyperFrames 專案用 `npx hyperframes init video/9x16 --non-interactive --skip-skills --resolution portrait -e blank` 建立（16:9 用 `landscape`、1:1 用 `square`），`--skip-skills` 是因為 skill 已經由 plugin 提供，不要再安裝一份。

## 步驟

每一步開始前先讀這一步列出的 reference。標 ✅ 的步驟要等使用者確認才往下走。

### 0. 檢查環境

執行 `scripts/preflight.sh`，它只回一行結果。失敗時照提示處理，不要逐項手動排查。

### 1. ✅ 需求

讀 `references/brief.md`，用裡面的問卷一次問完，把答案寫成 `video/BRIEF.md`。使用者已經在訊息裡回答的題目就不要再問。

### 2. 風格

讀 `references/style-from-refs.md`。使用者給的參考圖**只看一次**，萃取成 `video/FRAME.md`，之後都只讀 `FRAME.md`，不再打開參考圖。沒有參考圖時，從 HyperFrames 的 frame preset 挑一個最接近需求的，並在 `FRAME.md` 註明出處。

### 3. ✅ 腳本與分鏡

照 HyperFrames 的 work loop：先寫三條故事線讓使用者挑，再寫 `STORYBOARD.md`。長度超過 3 分鐘時，先讀 `references/long-form.md`，先給章節大綱，確認後才展開每一章的分鏡。

- 解說型：先寫完整口白，畫面跟著口白走
- 動效展示：先決定音樂，畫面依節拍安排（`npx hyperframes beats`）

### 4. 先鎖定聲音

讀 `references/audio.md`。有旁白時，先產生試聽讓使用者挑聲音，再把口白寫成 `video/voiceover.json`（中文用 MiniMax，英文用 ElevenLabs），然後：

1. `scripts/tts.mjs` 產生每一行的 mp3 和時間碼
2. `scripts/vo-timeline.mjs` 排出時間軸和字幕片段
3. 動畫時間寫成相對旁白錨點（`VO["s3-01"] + 0.2`）。之後旁白有改，跑 `scripts/retime.mjs` 一次更新所有比例，不用手改數字

- 本機：`node scripts/tts.mjs projects/<專案>/video/voiceover.json`，密鑰從環境變數或 macOS 鑰匙圈讀取
- 雲端：commit 並推上 `voiceover.json`，GitHub Actions 的 `tts` workflow 會產生音檔並 commit 回同一個分支，跑完後 `git pull --rebase` 拉回來

### 5. 實作

讀 `references/zh-typography.md`，多比例時再讀 `references/aspects.md`。文案寫進 HTML 後，用 `scripts/fonts.mjs` 下載只含用到的字的字型子集。先用 `/hyperframes-registry` 找現成元件，找不到才自己寫。Three.js 和 p5.js 照 HyperFrames 的 seek 協定，只根據時間點畫出畫面，不依賴上一格的狀態。

### 6. 自檢

讀 `references/qa-budget.md`，照裡面的分層和停止規則執行。日常檢查一律用 `scripts/qa.sh <aspect 專案資料夾>`，它把 lint 和 check 的結果整理成一行 PASS 或 FAIL，加上問題清單。

### 7. ✅ 預覽

用 `npx hyperframes render --quality draft` 渲染草稿，把檔案傳給使用者確認（`SendUserFile`）。草稿不放進 `outputs/`。

### 8. 交片

1. `scripts/render-all.sh projects/<專案>`：逐比例、逐章節渲染正式版，接合，用 ffprobe 驗證，複製到 `outputs/video/`
2. 把每個比例的 `REVIEW.md` 重點寫進回覆
3. mp4 不進 git，執行 `npm run jt -- archive` 直傳 R2
4. 其他檔案（BRIEF、FRAME、STORYBOARD、原始碼）照 JT-Projects 的規則 commit 推上 main

## 回覆格式

交片時固定用這個格式：

```
成品：outputs/video/<名稱>-9x16.mp4（0:32，1080×1920，-14.2 LUFS）
自檢：L0 ✅ L1 ✅ L2 ✅ L4 ✅（修了 2 個 P0、1 個 P1）
最弱的一段：t=12–15s 數字跳動節奏偏快，時間多的話會放慢 0.4 秒
沒驗證到：聲音只量過響度，沒有人耳聽過
```

## 常見錯誤

- 參考圖每輪都重看 → 只在步驟 2 看一次，之後讀 `FRAME.md`
- 還沒有旁白就開始做動畫，旁白一來整條時間軸重排 → 先做步驟 4
- 每改一個地方就重跑 `snapshot --review` → 只有 qa-budget 規定的時機才跑，其他時候用 `qa.sh`
- 用 `Math.random()` 或 three.js 的 `Clock`，每次渲染畫面不同 → 用固定 seed 的亂數，所有狀態都從時間算出來
- 中文字型直接寫 `font-family: "Noto Sans TC"`，渲染時變成方框或系統字 → 照 `zh-typography.md` 用 `@font-face` 指向 `assets/fonts/` 裡的檔案
- 長片改了一章就全部重新渲染 → 只重新渲染有改動的章節，再重新接合
- 動畫時間寫死成秒數，換聲音後幾十個數字要手改 → 寫成相對 `VO` 錨點，用 `retime.mjs` 更新
- 在 Claude Code 沙箱裡 `render` 失敗，訊息是 `EACCES ... mkdir '~/.cache/hyperframes'` → 指令前加 `HOME=<暫存資料夾>`，讓快取寫到可寫的地方
- 用 ElevenLabs 產生中文旁白，發音不自然 → 中文一律用 MiniMax
