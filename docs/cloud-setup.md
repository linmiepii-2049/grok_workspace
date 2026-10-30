# 雲端環境設定

讓手機、平板開 claude.ai/code 就能在 JT-Projects 工作，並自動歸檔。以下步驟只需要做一次。

## 1. Cloudflare API Token

1. 打開 <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → **Create Custom Token**
2. Token name：`jteam`
3. Permissions：

   | 類別    | 項目                      | 權限 |
   | ------- | ------------------------- | ---- |
   | Account | D1                        | Edit |
   | Account | Workers R2 Storage        | Edit |
   | Account | Workers Scripts           | Edit |
   | Account | Access: Apps and Policies | Edit |

4. Account Resources：Include → `Linmiepii@gmail.com's Account`
5. 建立後複製 token。這個畫面只顯示一次

## 2. 存進 GitHub Secrets

在 Mac 終端機執行，提示出現後貼上 token：

```bash
gh secret set CLOUDFLARE_API_TOKEN -R linmiepii-2049/JT-Projects
```

設好後到 GitHub repo 的 Actions → archive → **Run workflow**，確認歸檔成功。

## 3. claude.ai/code 授權 GitHub

1. 打開 <https://claude.ai/code>，連接 GitHub
2. 安裝 Claude GitHub App 時，選 **Only select repositories**，勾選 `JT-Projects` 和 `JT-Skills`

## 4. claude.ai/code 雲端環境

建立一個環境，名稱 `jteam`：

**網路存取**：選 Custom，在預設清單之外再加：

```
api.cloudflare.com
```

**環境變數**：

```
CLOUDFLARE_API_TOKEN=<步驟 1 的 token>
```

**Setup script**：留空。套件由 JT-Projects 的 SessionStart hook 自動安裝（`.claude/settings.json`），這樣同一個環境開 JT-Vault 也不會出錯。

## 5. 驗證

在手機開 claude.ai/code，選 JT-Projects 和 `jteam` 環境，輸入：

```
使用 skill-template skill：jt-skills check
```

看到 `✅ JT-Skills 已安裝` 就代表 skills 能從 private repo 安裝。再輸入：

```
npm run jt -- archive --dry-run
```

沒有出現錯誤，就代表 Cloudflare 連線正常。

## 6. 成品瀏覽頁的 Cloudflare Access

網址：<https://jteam.emvyax.com>（備用：<https://jteam-viewer.survey-api.workers.dev>）

Access 設好之前，瀏覽頁打得開，但所有成品和資料都會回 401，不會外洩。

1. 打開 Cloudflare Dashboard → **Workers & Pages** → `jteam-viewer` → **Settings** → **Domains & Routes**
2. 在 `workers.dev` 那一列打開 **Cloudflare Access**
   - 第一次用 Zero Trust 會要你取一個 team 名稱，並選方案：選 **Free**（50 人以內免費）
3. 點 **Manage Cloudflare Access** 進入這個 Access 應用程式，確認：
   - **Policies**：只有一條 Allow，Include → Emails → `linmiepii@gmail.com`
   - **Login methods**：One-time PIN
4. 在應用程式的 **Overview** 找到這兩個值，貼給 Claude（不是密鑰，可以直接貼在對話）：
   - **Application Audience (AUD) Tag**：一長串英數字
   - **Team domain**：`<team 名稱>.cloudflareaccess.com`

Claude 會把它們填進 `apps/viewer/wrangler.jsonc` 再部署，瀏覽頁就會開始驗證登入。

### 6.1 自訂網域 jteam.emvyax.com

`wrangler.jsonc` 的 `routes` 會在部署時自動建立 DNS 與憑證。部署後到 Zero Trust → **Access** → **Applications** → 剛才那個 jteam-viewer 應用程式 → **Edit** → **Public hostnames**（或 Destinations）→ **Add**，加上 `jteam.emvyax.com`。

- 要加在**同一個**應用程式，AUD 才會一樣，不用改 `ACCESS_AUD`
- 沒加之前，自訂網域的頁面打得開，但 API 全部回 401，不會外洩

## 7. Google Drive（移到 Drive 功能）

### 7.1 建立 Google Cloud 專案與 OAuth 用戶端

1. 打開 <https://console.cloud.google.com/projectcreate>，專案名稱填 `JTeam`，建立
2. 左上選單 → **API 和服務** → **程式庫**，搜尋 **Google Drive API** → **啟用**
3. 左上選單 → **Google Auth Platform**（或「OAuth 同意畫面」）→ **開始**
   - 應用程式名稱：`JTeam Viewer`；使用者支援電子郵件：`linmiepii@gmail.com`
   - 目標對象：**外部**
   - 聯絡資訊：`linmiepii@gmail.com`
4. **資料存取** → **新增或移除範圍**，勾選這三個後儲存：
   - `.../auth/drive.file`
   - `openid`
   - `.../auth/userinfo.email`
5. **目標對象** → **發布應用程式** → 確認，狀態要變成「**實際運作中**」
   - ⚠️ 停在「測試」的話，授權每 7 天就失效，搬移會突然壞掉
   - `drive.file` 屬於非敏感範圍，發布不需要 Google 審查
6. **用戶端** → **建立用戶端**
   - 應用程式類型：**網頁應用程式**；名稱：`jteam-viewer`
   - 已授權的重新導向 URI（兩個都加）：
     - `https://jteam.emvyax.com/api/gdrive/callback`
     - `https://jteam-viewer.survey-api.workers.dev/api/gdrive/callback`
   - 建立後複製 **用戶端 ID** 和 **用戶端密鑰**

### 7.2 把密鑰存進 Worker

在 Mac 終端機、JT-Projects 資料夾裡依序執行，每個指令出現提示後貼上對應的值：

```bash
npx wrangler secret put GOOGLE_CLIENT_ID -c apps/viewer/wrangler.jsonc
```

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET -c apps/viewer/wrangler.jsonc
```

這一行不用貼任何東西，它會自動產生加密金鑰（用來加密存在 D1 的 Google 授權）：

```bash
openssl rand -base64 32 | npx wrangler secret put TOKEN_KEY -c apps/viewer/wrangler.jsonc
```

### 7.3 連結

打開瀏覽頁首頁最下方「Google Drive」→ **連結 Google Drive** → 選 `linmiepii@gmail.com` → 允許。回到瀏覽頁會顯示「已連結」。

## 8. Obsidian 筆記庫（JT-Vault）

筆記庫是獨立的 private repo `linmiepii-2049/JT-Vault`（舊的 iCloud AI-vault 不再使用）。手機、平板的設定步驟在 JT-Vault 的 README。

在 claude.ai/code 整理筆記：開新 session 時選 **JT-Vault** repo（不是 JT-Projects），Claude 會依 JT-Vault 的 CLAUDE.md 放對資料夾、加 frontmatter，改完 commit 推上 GitHub，手機的 Obsidian Git 會自動拉下來。

## 9. 備份

| 資料 | 備份方式 |
| --- | --- |
| D1 | 每週一 03:00 自動匯出到 R2 `backups/d1/`，保留 90 天；另有 D1 Time Travel 30 天 |
| 程式、skills、筆記 | GitHub repo 本身 |
| 成品檔案 | R2；搬到 Drive 的以 Drive 為準 |

手動備份：GitHub → JT-Projects → Actions → backup → Run workflow。
