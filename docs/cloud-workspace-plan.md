# JTeam 全雲端工作環境 — 實作計畫

> 狀態：待確認（第 2 版）· 2026-10-28
>
> 第 2 版變更：① 既有 skill 不遷移，之後逐一重寫再上架 ② 瀏覽頁新增「移到 Google Drive 並從 R2 移除」

## 0. 現況盤點

| 項目           | 現況                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub         | `linmiepii-2049`，gh 已登入                                                                                                                                                                               |
| Cloudflare     | wrangler 4.54 已 OAuth 登入（帳號 `090a0403…`）                                                                                                                                                           |
| Skills 原始碼  | `/Volumes/mac/CursorProjects/Skill`（26 個，非 git，只有 ai-news-skill 有 git）；`~/.claude/skills` 多為 symlink，另有 3 個只在本機：`Agent-harness-skill`、`follow-builders-main`、`learn-english-daily` |
| JT-Projects    | 空資料夾                                                                                                                                                                                                  |
| Obsidian vault | iCloud `AI-vault`，131 檔但只佔 24K → 多數被 iCloud 卸載，遷移前需先下載                                                                                                                                  |
| 本機記憶       | 無                                                                                                                                                                                                        |

## 1. 整體架構

```
手機 / 平板
 └─ Claude App · claude.ai/code（雲端 session）
      ├─ 開 JT-Projects（monorepo，private）
      │    └─ .claude/skills/ 由 JT-Skills 自動同步（雲端不安裝 marketplace plugin）
      ├─ 產出成品 → projects/<slug>/outputs/
      ├─ 大檔（影片 >20MB）→ session 內 `jt archive` 直傳 R2
      └─ git push → GitHub Actions → 小檔歸檔到 R2 + 中繼資料寫 D1
                                     ↓
                  jteam-viewer（Cloudflare Worker + Access 登入）手機瀏覽成品
                                     ↓ 手動「移到 Google Drive」
                  Google Drive 驗證檔案一致 → 從 R2 刪除 → D1 改記 Drive 連結
```

## 2. Repo 1：JT-Skills（private）

每個 skill = 一個 plugin，各自版號、各自安裝、各自 changelog。

```
JT-Skills/
├─ .claude-plugin/marketplace.json     # 列出所有 skill plugin
├─ plugins/<skill-name>/
│   ├─ .claude-plugin/plugin.json      # version: semver
│   ├─ skills/<skill-name>/SKILL.md (+ scripts/ references/)
│   └─ CHANGELOG.md
├─ scripts/new-skill.sh、bump.sh、validate.mjs     # 建立 / 升版 / 檢查；tag 由 CI 自動建立 `<name>--vX.Y.Z`（官方格式）
└─ .github/workflows/validate.yml      # frontmatter 檢查；skill 內容有改但版號沒升 → 擋 PR
```

- **這次只建骨架，不上傳任何既有 skill**：repo 結構、`_template` 範本 plugin、release 腳本、CI
- 既有 skill 之後**逐一重寫**，每個重寫完以新 plugin `v1.0.0` 上架（用 skill-format-guide 規範 + CI 檢查）
- 過渡期：Mac 本機照舊用原本的 skill；雲端 session 在重寫上架前**沒有這些 skill**
- 重寫時要讓 skill 能在雲端跑，注意事項（寫進 `_template` 的 README）：

| 類型         | 舊 skill 例子                               | 雲端化原則                                                 |
| ------------ | ------------------------------------------- | ---------------------------------------------------------- |
| 寫死本機路徑 | obsidian-skill（iCloud vault）              | 路徑一律相對 repo 或讀環境變數                             |
| 系統工具     | trim-to-srt（ffmpeg、語音模型）             | 依賴寫進 skill 的 `requirements`，由雲端 setup script 安裝 |
| 網頁自動化   | comic-storyboard（`gemini_web_handler.py`） | 改用官方 API                                               |
| 密鑰         | telegram-*、ai-news（Bot token / API key）  | 只讀環境變數，不寫進檔案                                   |
| 本機 App     | eagle / blender MCP                         | 標記 `local-only`，雲端不啟用                              |
| 成品輸出     | 所有會產出檔案的 skill                      | 一律寫到 `projects/<slug>/outputs/`                        |

## 3. Repo 2：JT-Projects（monorepo，private）

```
JT-Projects/
├─ CLAUDE.md                 # 全域偏好（律伸、繁中…）+ 歸檔規則 + 記憶
├─ memory/                   # 取代本機 memory，feedback 規則入版控
├─ .claude/settings.json     # Stop hook
├─ .claude/skills/           # JT-Skills 同步進來，版號見 .jt-skills.json
├─ projects/<yyyy-mm>-<slug>/
│   ├─ project.json          # 名稱、標籤、狀態
│   └─ outputs/              # ← 只有這裡的東西會歸檔
├─ tools/jt/                 # `jt archive`、`jt new <slug>` CLI
├─ infra/
│   ├─ wrangler.toml
│   └─ d1/migrations/*.sql
├─ apps/viewer/              # 成品瀏覽頁
└─ .github/workflows/
    ├─ archive.yml           # push 後歸檔
    ├─ deploy-viewer.yml
    └─ backup.yml            # 每週 D1 export → R2 backups/
```

> 全域偏好放在 repo 根目錄 `CLAUDE.md`：雲端 session 一開就讀得到，這是解決「雲端讀不到本機設定」最直接的辦法。

## 4. Cloudflare 資源

| 資源                 | 名稱            | 用途                                                           |
| -------------------- | --------------- | -------------------------------------------------------------- |
| D1                   | `jteam`         | 專案、成品中繼資料、文案全文搜尋                               |
| R2                   | `jteam`         | 成品檔案、D1 備份                                              |
| Worker（含靜態資源） | `jteam-viewer`  | 成品瀏覽頁 + API                                               |
| Workflows            | `jteam-offload` | 搬到 Google Drive 的長時間任務（大影片分段上傳、失敗自動重試） |
| KV                   | （暫不建）      | 之後需要快取時再建 `JTeam`                                     |

> 瀏覽頁從 Pages 改成 Worker：搬移影片需要用到 Workflows，Workflows 只能綁在 Worker 上。

**D1 schema（初版）**

```sql
projects(id, slug UNIQUE, name, status, tags, created_at, updated_at)
artifacts(id, project_id, kind,          -- image|video|html|copy|slides|other
          title, r2_key, content_type, size, sha256, version,
          git_commit, body,              -- 文案全文存這裡方便搜尋
          md5,                           -- 用來和 Drive 回傳的 md5Checksum 比對
          storage,                       -- r2 | offloading | gdrive
          gdrive_file_id, gdrive_url, offloaded_at,
          meta JSON, created_at)
offload_jobs(id, artifact_ids JSON, status, error, created_at, finished_at)
-- 不用 FTS5：D1 export 不支援虛擬表，會讓備份失敗；個人規模用 LIKE 搜尋即可
-- 完整定義：infra/d1/migrations/0001_init.sql
```

**R2 路徑**：`projects/<slug>/<kind>/<name>@<sha8>.<ext>`，同內容自動去重，改版保留舊版。

## 5. 自動歸檔流程

1. 雙軌：
   - 小檔（≤20MB）進 git → push 觸發 `archive.yml` → 依副檔名判斷類型 → 上傳 R2 → upsert D1
   - 大檔（影片等）`.gitignore` 排除 → session 內跑 `jt archive` 直傳 R2，寫 D1，並 commit 一個 `.r2.json` 指標檔
2. 安全網：Claude Code **Stop hook** 檢查 `outputs/` 有未歸檔大檔時提醒或自動執行 `jt archive`
3. `CLAUDE.md` 寫明規則：成品一律放 `outputs/`

> 為什麼影片不進 git：GitHub 單檔上限 100MB，repo 也會越來越大，手機端 clone 會很慢。

## 6. 成品瀏覽頁（jteam-viewer）

- 手機優先介面：專案列表 → 成品格狀瀏覽 → 依類型預覽
  - 圖片：縮圖 + 全螢幕
  - 影片：串流播放（R2 range request）
  - HTML / HTML 簡報：sandbox iframe
  - pptx：下載
  - 文案：全文顯示、一鍵複製、搜尋
- Worker 綁定 D1 / R2，不公開 R2 bucket
- **Cloudflare Access**：只允許 `linmiepii@gmail.com` 用 email OTP 登入
- 每個成品都有「下載到裝置」按鈕

### 6.1 移到 Google Drive（減輕 R2 用量）

**操作**：勾選單一或多個成品，或直接選「整個專案」→ 按「移到 Google Drive」→ 確認視窗會列出檔案數和總大小，並提醒「R2 會刪除這些檔案」

**流程**（由 `jteam-offload` Workflow 執行，每一步失敗都會自動重試，不會出現檔案只搬一半的狀況）：

1. D1 把狀態標成 `offloading`
2. 從 R2 串流讀出檔案，用分段續傳上傳到 Drive，資料夾結構為 `JTeam/<專案 slug>/<類型>/`
3. **驗證**：Drive 回傳的 `md5Checksum` 和檔案大小，要跟 D1 記錄的一致
4. 驗證通過才刪 R2 → D1 改成 `storage=gdrive`，記下 Drive 檔案 ID 和連結
5. 驗證失敗 → R2 保留不刪，狀態退回 `r2`，瀏覽頁顯示錯誤

**搬走之後**：

- 成品照樣出現在瀏覽頁，標上「☁ Drive」，點開會跳到 Google Drive
- 文案內容仍保留在 D1，搜尋不受影響
- 圖片另存一張小縮圖（約 20KB）在 R2，瀏覽頁仍看得到預覽

**R2 用量**：瀏覽頁首頁顯示 R2 目前用量和免費額度（10GB）的百分比，並列出「最大的 / 最久沒看的」成品，方便挑選要搬走哪些

**Google 授權**：OAuth scope 只用 `drive.file`，表示這個 App 只能讀寫自己建立的檔案，碰不到你 Drive 裡的其他東西

## 7. Obsidian vault 上雲

建議放在**獨立的 private repo `JT-Vault`**，不放進 monorepo：

- 手機 Obsidian + Obsidian Git plugin 同步，只 clone vault，不會拖到整個 monorepo
- obsidian-skill 在雲端 session 透過 git 寫入 JT-Vault

## 8. 需要你親自操作的步驟（安全規則下我不能代填密鑰）

1. Cloudflare Dashboard 建立 API Token（權限：D1 Edit、R2 Edit、Workers Scripts Edit、Access Edit，限你的帳號）
2. 把 token 存成 GitHub Secret：`gh secret set CLOUDFLARE_API_TOKEN -R linmiepii-2049/JT-Projects`（指令會提示你貼上）
3. claude.ai/code → 安裝 Claude GitHub App，授權 JT-Projects、JT-Skills、JT-Vault
4. claude.ai/code 雲端環境設定：
   - 環境變數放 CF token 和其他 API key
   - 網路存取加白名單 `*.cloudflare.com`、`*.r2.cloudflarestorage.com`
   - 貼上我提供的 setup script
5. 在 Mac 上把 iCloud 的 AI-vault 設為「保留下載」
6. Google Cloud Console（我會給逐步截圖說明）：
   - 建專案 → 啟用 Drive API → 建 OAuth 用戶端（網頁應用程式）
   - 同意畫面要**發布為「正式版」**：停在「測試」狀態的話，授權每 7 天就會失效，搬移功能會突然壞掉。`drive.file` 屬於非敏感權限，發布不需要 Google 審查
   - 把 Client ID / Secret 用 `wrangler secret put` 存進 Worker（指令會提示你貼上）
   - 打開瀏覽頁按「連結 Google Drive」完成授權

## 9. 執行順序

| 階段 | 內容                                                                                         | 驗收                                          |
| ---- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| P1 ✅ | 建 D1 / R2、套 migration（2026-10-28 完成，D1 id `5d9e7ec0-…`，皆在 APAC）                                                                     | `wrangler d1 execute` 查得到表                |
| P2 ✅ | JT-Skills 骨架（2026-10-28 完成）：marketplace、skill-template、腳本、CI                                   | 範本 plugin 能在本機與雲端安裝                |
| P3 ✅ | （2026-10-28 完成，本機與 Actions 歸檔都驗證過）JT-Projects repo + CLAUDE.md + jt CLI + archive workflow                                     | push 範例成品後 D1 有資料、R2 有檔            |
| P4   | jteam-viewer + Access + 下載到裝置                                                           | 手機登入看得到範例成品                        |
| P5   | 移到 Google Drive（Workflow + OAuth + R2 用量面板）                                          | 100MB 測試影片搬到 Drive、md5 相符、R2 已刪除 |
| P6   | JT-Vault 遷移 + backup workflow                                                              | 手機 Obsidian 同步成功                        |
| P7   | **手機端全流程實測**：claude.ai/code 開新專案 → 產圖 + HTML + 影片 → 瀏覽頁看到 → 搬到 Drive | 全程不碰 Mac                                  |
| 之後 | 逐一重寫既有 skill（每個 skill 一個 PR）                                                     | 每個 skill 通過 CI 並在雲端實測               |

## 10. 風險 / 待驗證

- ~~雲端 session 能否從 private 的 JT-Skills 安裝 plugin~~ → 已確認不行：官方文件寫明雲端不安裝 repo 設定的 plugin。改由 JT-Skills 的 `sync` workflow 把 skill 複製進 JT-Projects `.claude/skills/`（2026-10-28）
- Cloudflare 免費額度：R2 10GB，影片多時可能要付費（約 US$0.015/GB/月）
- R2 沒有物件版本控制：靠「檔名帶 sha」保留舊版。整套系統**只有一條路徑會刪 R2**，就是 Drive md5 驗證通過之後
- 搬走後 Drive 就是唯一的一份：之後如果你在 Drive 手動刪掉，就真的沒了。瀏覽頁點開時若發現 Drive 檔案不存在，會標示「遺失」
- Google 授權失效（例如你撤銷授權）：搬移按鈕會變成「重新連結 Google Drive」，不會靜默失敗
