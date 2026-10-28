// Google Drive：OAuth 授權、refresh token 加密保存、資料夾、分段續傳上傳
// scope 只用 drive.file：這個 App 只看得到、改得到自己建立的檔案

const SCOPE = "https://www.googleapis.com/auth/drive.file openid email";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export class DriveAuthError extends Error {}

export const driveConfigured = (env) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_KEY);

export const redirectUri = (origin) => `${origin}/api/gdrive/callback`;

// ---------- 加密 ----------

const b64 = {
  encode: (bytes) => btoa(String.fromCharCode(...bytes)),
  decode: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

const aesKey = (env) =>
  crypto.subtle.importKey("raw", b64.decode(env.TOKEN_KEY), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);

async function encrypt(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await aesKey(env),
      data,
    ),
  );
  return b64.encode(new Uint8Array([...iv, ...ct]));
}

async function decrypt(env, s) {
  const raw = b64.decode(s);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    await aesKey(env),
    raw.slice(12),
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---------- OAuth ----------

export function authUrl(env, origin, state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // 每次都拿到 refresh token
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function connect(env, origin, code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.refresh_token)
    throw new DriveAuthError(
      body.error_description || body.error || "沒有取得 refresh token",
    );
  // id_token 直接從 Google token 端點經 TLS 取得，只用來顯示帳號，不需另外驗簽
  const email = JSON.parse(
    atob(body.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
  ).email;
  await env.DB.prepare(
    `INSERT INTO integrations (name, data, account) VALUES ('gdrive', ?, ?)
     ON CONFLICT (name) DO UPDATE SET data = excluded.data, account = excluded.account,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  )
    .bind(await encrypt(env, { refresh_token: body.refresh_token }), email)
    .run();
  tokenCache = null;
  return email;
}

export async function status(env) {
  if (!driveConfigured(env)) return { configured: false, connected: false };
  const row = await env.DB.prepare(
    `SELECT account, updated_at FROM integrations WHERE name = 'gdrive'`,
  ).first();
  return {
    configured: true,
    connected: Boolean(row),
    account: row?.account ?? null,
    connected_at: row?.updated_at ?? null,
  };
}

let tokenCache = null; // { token, expiresAt }

async function accessToken(env) {
  if (tokenCache && tokenCache.expiresAt - 60_000 > Date.now())
    return tokenCache.token;
  const row = await env.DB.prepare(
    `SELECT data FROM integrations WHERE name = 'gdrive'`,
  ).first();
  if (!row) throw new DriveAuthError("尚未連結 Google Drive");
  const { refresh_token } = await decrypt(env, row.data);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json();
  // invalid_grant：使用者撤銷授權，或同意畫面停在「測試」狀態滿 7 天
  if (!res.ok)
    throw new DriveAuthError(
      `Google 授權失效（${body.error}），請重新連結 Google Drive`,
    );
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return tokenCache.token;
}

async function drive(env, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${await accessToken(env)}`,
    },
  });
  if (res.status === 401) tokenCache = null;
  return res;
}

const failed = async (res, what) =>
  new Error(`${what}失敗：${res.status} ${await res.text()}`);

// ---------- 檔案與資料夾 ----------

const q = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function ensureFolder(env, path) {
  let parent = "root";
  let prefix = "";
  for (const name of path.split("/")) {
    prefix = prefix ? `${prefix}/${name}` : name;
    const cached = await env.DB.prepare(
      `SELECT folder_id FROM gdrive_folders WHERE path = ?`,
    )
      .bind(prefix)
      .first();
    // 快取的資料夾可能被使用者刪掉，確認還在
    if (cached && (await fileExists(env, cached.folder_id))) {
      parent = cached.folder_id;
      continue;
    }
    const search = await drive(
      env,
      `${DRIVE}/files?${new URLSearchParams({
        q: `name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and '${parent}' in parents and trashed = false`,
        fields: "files(id)",
        pageSize: "1",
      })}`,
    );
    if (!search.ok) throw await failed(search, "查詢資料夾");
    let id = (await search.json()).files[0]?.id;
    if (!id) {
      const created = await drive(env, `${DRIVE}/files?fields=id`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME,
          parents: [parent],
        }),
      });
      if (!created.ok) throw await failed(created, "建立資料夾");
      id = (await created.json()).id;
    }
    await env.DB.prepare(
      `INSERT INTO gdrive_folders (path, folder_id) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET folder_id = excluded.folder_id`,
    )
      .bind(prefix, id)
      .run();
    parent = id;
  }
  return parent;
}

export async function fileExists(env, id) {
  const res = await drive(env, `${DRIVE}/files/${id}?fields=id,trashed`);
  if (res.status === 404) return false;
  if (!res.ok) throw await failed(res, "查詢檔案");
  return !(await res.json()).trashed;
}

export async function deleteFile(env, id) {
  const res = await drive(env, `${DRIVE}/files/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw await failed(res, "刪除 Drive 檔案");
}

const FILE_FIELDS = "id,md5Checksum,size,webViewLink";

export async function startUpload(env, { name, mimeType, size, parentId }) {
  const res = await drive(
    env,
    `${UPLOAD}/files?uploadType=resumable&fields=${FILE_FIELDS}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mimeType,
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({ name, parents: [parentId] }),
    },
  );
  if (!res.ok) throw await failed(res, "建立上傳工作階段");
  return res.headers.get("location");
}

// 上傳 [start, end] 這一段。重試時先問 Drive 已收到多少，從那裡接著傳，避免重複或漏傳
// 回傳 { done: true, file } 或 { done: false, received }
export async function uploadRange(env, session, readRange, start, end, total) {
  const probe = await fetch(session, {
    method: "PUT",
    headers: { "content-range": `bytes */${total}` },
  });
  if (probe.status === 200 || probe.status === 201)
    return { done: true, file: await probe.json() };
  if (probe.status !== 308) throw await failed(probe, "查詢上傳進度");
  const range = probe.headers.get("range"); // 例：bytes=0-33554431
  const received = range ? Number(range.split("-")[1]) + 1 : 0;
  const from = Math.max(start, received);
  if (from > end) return { done: false, received };

  const length = end - from + 1;
  const { readable, writable } = new FixedLengthStream(length);
  const body = await readRange(from, length);
  const piping = body.pipeTo(writable);
  const res = await fetch(session, {
    method: "PUT",
    headers: {
      "content-length": String(length),
      "content-range": `bytes ${from}-${end}/${total}`,
    },
    body: readable,
  });
  await piping;
  if (res.status === 200 || res.status === 201)
    return { done: true, file: await res.json() };
  if (res.status === 308) return { done: false, received: end + 1 };
  throw await failed(res, "上傳");
}

// 空檔案：直接送一個沒有內容的請求完成上傳
export async function uploadEmpty(session) {
  const res = await fetch(session, {
    method: "PUT",
    headers: { "content-length": "0", "content-range": "bytes */0" },
  });
  if (res.status === 200 || res.status === 201) return res.json();
  throw await failed(res, "上傳空檔案");
}
