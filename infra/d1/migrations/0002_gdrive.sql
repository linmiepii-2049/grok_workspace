-- 搬到 Google Drive 所需的資料表

-- 外部服務的授權資料。data 是以 Worker secret TOKEN_KEY 做 AES-GCM 加密後的 JSON，D1 裡只存密文
CREATE TABLE integrations (
  name        TEXT PRIMARY KEY,                     -- 'gdrive'
  data        TEXT NOT NULL,
  account     TEXT,                                 -- 連結的 Google 帳號 email，顯示用
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Drive 資料夾 id 快取，避免每次搬移都重新查詢；路徑如 JTeam/2026-10-sample/image
CREATE TABLE gdrive_folders (
  path        TEXT PRIMARY KEY,
  folder_id   TEXT NOT NULL
);

ALTER TABLE offload_jobs ADD COLUMN done_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE offload_jobs ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0;
