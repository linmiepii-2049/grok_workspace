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

**Setup script**：

```bash
npm ci
```

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

網址：<https://jteam-viewer.survey-api.workers.dev>

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
