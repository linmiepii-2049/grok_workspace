-- JTeam 初始 schema
-- 時間一律存 UTC ISO 8601 字串；JSON 欄位存 TEXT 並以 json_valid 檢查
-- 不使用 FTS5：D1 的 `wrangler d1 export` 不支援虛擬表，會讓每週備份失敗

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE,              -- 對應 projects/<slug>/
  name        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'archived')),
  tags        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE artifacts (
  id              INTEGER PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  kind            TEXT    NOT NULL
                          CHECK (kind IN ('image', 'video', 'html', 'copy', 'slides', 'other')),
  title           TEXT    NOT NULL,
  path            TEXT    NOT NULL,                 -- 相對 outputs/ 的路徑，同一路徑的不同內容視為不同版本
  version         INTEGER NOT NULL DEFAULT 1,
  content_type    TEXT    NOT NULL,
  size            INTEGER NOT NULL CHECK (size >= 0),
  sha256          TEXT    NOT NULL,
  md5             TEXT    NOT NULL,                 -- 搬到 Drive 時與 md5Checksum 比對
  git_commit      TEXT,
  body            TEXT,                             -- 文案全文，供搜尋

  storage         TEXT    NOT NULL DEFAULT 'r2'
                          CHECK (storage IN ('r2', 'offloading', 'gdrive')),
  r2_key          TEXT,                             -- projects/<slug>/<kind>/<name>@<sha8>.<ext>
  thumb_key       TEXT,                             -- 圖片縮圖，搬到 Drive 後仍保留
  gdrive_file_id  TEXT,
  gdrive_url      TEXT,
  offloaded_at    TEXT,
  last_viewed_at  TEXT,                             -- 用來列出「最久沒看」的成品

  meta            TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (project_id, path, sha256),
  UNIQUE (project_id, path, version),
  -- 檔案一定存在某一處：在 R2 就要有 r2_key，在 Drive 就要有 file id
  CHECK (storage <> 'r2'     OR r2_key IS NOT NULL),
  CHECK (storage <> 'gdrive' OR (gdrive_file_id IS NOT NULL AND r2_key IS NULL))
);

CREATE INDEX idx_artifacts_project   ON artifacts (project_id, created_at DESC);
CREATE INDEX idx_artifacts_storage   ON artifacts (storage, size DESC);
CREATE INDEX idx_artifacts_viewed    ON artifacts (storage, last_viewed_at);
CREATE UNIQUE INDEX idx_artifacts_r2 ON artifacts (r2_key) WHERE r2_key IS NOT NULL;

CREATE TABLE offload_jobs (
  id            TEXT PRIMARY KEY,                   -- Workflow instance id
  artifact_ids  TEXT NOT NULL CHECK (json_valid(artifact_ids)),
  status        TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at   TEXT
);

CREATE INDEX idx_offload_jobs_status ON offload_jobs (status, created_at DESC);

CREATE TRIGGER trg_projects_updated_at
AFTER UPDATE ON projects
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
