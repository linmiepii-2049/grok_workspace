# JT-Projects

Jason 的雲端工作區（monorepo）。手機、平板或 Mac 開 Claude Code 都在這裡工作，成品自動歸檔到 Cloudflare R2 / D1。

## 使用者偏好

- 一律用繁體中文回覆
- 每次回覆以 `律伸` 開頭
- 需求不明確時，先問清楚再寫程式
- 使用者要求先提案時，提出方案後等待確認再實作
- 被糾正後，把規則寫進 `memory/`（見下方「記憶」）

## 專案與成品

- 新專案一律用 `npm run jt -- new <slug> "<名稱>"` 建立，會產生 `projects/<yyyy-mm>-<slug>/`
- **成品一律放在 `projects/<專案>/outputs/`**，只有這裡的檔案會被歸檔；草稿、原始碼放在專案資料夾的其他地方
- 檔案類型由副檔名判斷：
  - 圖片：png jpg webp svg gif avif
  - 影片：mp4 mov webm mkv
  - HTML：html
  - 文案：md txt
  - 簡報：pptx、`*.slides.html`，或放在 `outputs/slides/` 底下
- 歸檔：
  - 小檔推上 GitHub 後，Actions 會自動歸檔，不用手動處理
  - 影片和音檔被 `.gitignore` 排除，不進 git，要在 session 內執行 `npm run jt -- archive` 直傳 R2
  - session 結束時，Stop hook 會檢查有沒有沒歸檔的大檔
- 同一個檔案改版後再歸檔，會存成新版本，舊版保留

## Skills

- `.claude/skills/` 由 JT-Skills repo 自動同步，**不要直接修改**，下次同步會被覆蓋
- 要新增或修改 skill，到 `linmiepii-2049/JT-Skills` 開 PR；目前各 skill 的版號見 `.claude/skills/.jt-skills.json`

## 記憶

雲端 session 沒有本機的記憶庫，記憶改存在 repo 裡，進版控：

- 每條記憶一個檔案：`memory/<kebab-case>.md`，格式和規則見 `memory/README.md`
- 新增後在 `memory/MEMORY.md` 加一行索引
- 開始工作前先讀 `memory/MEMORY.md`

## Git

- 一般工作（新增專案、成品、文案）**直接 commit 推到 `main`**，不用開分支或 PR：只有一個人使用，main 就是最新狀態
- 修改 `tools/`、`apps/`、`infra/`、`.github/` 這類程式或設定時，開分支與 PR，讓使用者確認後再合併
- 推之前先 `git pull --rebase origin main`

## 安全

- 密鑰（Cloudflare token、API key）只放環境變數或 GitHub Secrets，絕不寫進檔案或 commit
- 不刪除 R2 物件；要釋出 R2 空間，用 jteam-viewer 的「移到 Google Drive」

## 目錄

| 路徑        | 用途                              |
| ----------- | --------------------------------- |
| `projects/` | 各專案                            |
| `memory/`   | 記憶                              |
| `tools/jt/` | `jt` CLI（new / archive / check） |
| `infra/`    | Cloudflare 設定、D1 migration     |
| `docs/`     | 計畫、雲端環境設定說明            |
