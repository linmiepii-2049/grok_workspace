// jteam-viewer Worker：/api/* 回傳 D1 資料，/files/* 從 R2 串流成品；其餘由靜態資源處理
// 每個請求都驗證 Cloudflare Access 的 JWT：就算有人繞過 Access（例如設定被關掉），也拿不到資料

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

const error = (status, message) => json({ error: message }, { status });

// ---------- Access JWT ----------

let jwksCache = { team: null, keys: null, fetchedAt: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000; // Cloudflare 會輪替金鑰，一小時重抓一次

const b64urlDecode = (s) =>
  Uint8Array.from(
    atob(
      s
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(s.length / 4) * 4, "="),
    ),
    (c) => c.charCodeAt(0),
  );

async function getKeys(team) {
  if (
    jwksCache.team === team &&
    jwksCache.keys &&
    Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  )
    return jwksCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`無法取得 Access 金鑰：${res.status}`);
  const { keys } = await res.json();
  jwksCache = { team, keys, fetchedAt: Date.now() };
  return keys;
}

async function verifyAccess(request, env) {
  if (env.DEV_BYPASS === "1") return { email: env.ALLOWED_EMAIL };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;

  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    const jwk = (await getKeys(env.ACCESS_TEAM_DOMAIN)).find(
      (k) => k.kid === header.kid,
    );
    if (!jwk || header.alg !== "RS256") return null;

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!valid) return null;

    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (payload.exp < now || (payload.nbf && payload.nbf > now)) return null;
    if (payload.email?.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase())
      return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

// ---------- API ----------

const LATEST_ONLY = `a.version = (SELECT MAX(b.version) FROM artifacts b WHERE b.project_id = a.project_id AND b.path = a.path)`;
const LIST_COLUMNS = `a.id, a.kind, a.title, a.path, a.version, a.content_type, a.size, a.storage, a.gdrive_url, a.created_at,
  substr(a.body, 1, 160) AS excerpt,
  (SELECT COUNT(*) FROM artifacts b WHERE b.project_id = a.project_id AND b.path = a.path) AS versions`;

async function listProjects(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.slug, p.name, p.status, p.tags, p.updated_at,
            COUNT(DISTINCT a.path) AS artifacts,
            COALESCE(SUM(CASE WHEN a.storage = 'r2' THEN a.size END), 0) AS r2_bytes,
            MAX(a.created_at) AS last_artifact_at,
            (SELECT c.id FROM artifacts c WHERE c.project_id = p.id AND c.kind = 'image' AND c.storage = 'r2'
              ORDER BY c.created_at DESC LIMIT 1) AS cover_id
     FROM projects p LEFT JOIN artifacts a ON a.project_id = p.id
     GROUP BY p.id
     ORDER BY COALESCE(MAX(a.created_at), p.updated_at) DESC`,
  ).all();
  return results.map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
}

async function getProject(env, slug) {
  const project = await env.DB.prepare(
    `SELECT id, slug, name, status, tags, created_at, updated_at FROM projects WHERE slug = ?`,
  )
    .bind(slug)
    .first();
  if (!project) return null;
  const { results } = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM artifacts a WHERE a.project_id = ? AND ${LATEST_ONLY} ORDER BY a.created_at DESC, a.path`,
  )
    .bind(project.id)
    .all();
  const { id, ...rest } = project;
  return { ...rest, tags: JSON.parse(project.tags), artifacts: results };
}

async function getArtifact(env, id) {
  const artifact = await env.DB.prepare(
    `SELECT a.id, a.kind, a.title, a.path, a.version, a.content_type, a.size, a.sha256, a.git_commit, a.body,
            a.storage, a.gdrive_url, a.offloaded_at, a.created_at, a.meta, p.slug AS project_slug, p.name AS project_name
     FROM artifacts a JOIN projects p ON p.id = a.project_id WHERE a.id = ?`,
  )
    .bind(id)
    .first();
  if (!artifact) return null;
  const { results: versions } = await env.DB.prepare(
    `SELECT b.id, b.version, b.size, b.created_at, b.storage FROM artifacts b
     JOIN artifacts a ON a.project_id = b.project_id AND a.path = b.path
     WHERE a.id = ? ORDER BY b.version DESC`,
  )
    .bind(id)
    .all();
  return { ...artifact, meta: JSON.parse(artifact.meta), versions };
}

async function search(env, q) {
  if (!q || q.trim().length < 1) return [];
  // 個人資料量用 LIKE 就夠；FTS5 會讓 D1 export 失敗（見 migration 註解）
  const like = `%${q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const { results } = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS}, p.slug AS project_slug, p.name AS project_name
     FROM artifacts a JOIN projects p ON p.id = a.project_id
     WHERE ${LATEST_ONLY} AND (a.title LIKE ?1 ESCAPE '\\' OR a.path LIKE ?1 ESCAPE '\\' OR a.body LIKE ?1 ESCAPE '\\' OR p.name LIKE ?1 ESCAPE '\\')
     ORDER BY a.created_at DESC LIMIT 50`,
  )
    .bind(like)
    .all();
  return results;
}

async function usage(env) {
  const total = await env.DB.prepare(
    `SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS objects FROM artifacts WHERE storage = 'r2'`,
  ).first();
  const pick = (order) =>
    env.DB.prepare(
      `SELECT a.id, a.title, a.path, a.kind, a.size, a.last_viewed_at, a.created_at, p.slug AS project_slug, p.name AS project_name
       FROM artifacts a JOIN projects p ON p.id = a.project_id WHERE a.storage = 'r2' ORDER BY ${order} LIMIT 5`,
    ).all();
  const [largest, stalest] = await Promise.all([
    pick("a.size DESC"),
    pick("COALESCE(a.last_viewed_at, a.created_at) ASC"),
  ]);
  return {
    ...total,
    quota_bytes: Number(env.R2_QUOTA_BYTES),
    largest: largest.results,
    stalest: stalest.results,
  };
}

// ---------- 檔案 ----------

// 使用者的 HTML / SVG 和瀏覽頁同網域：用 CSP sandbox 讓它變成獨立來源，碰不到 Access cookie 與 API
const SANDBOXED_TYPES = /^(text\/html|image\/svg\+xml)/;

async function serveFile(request, env, ctx, id) {
  const row = await env.DB.prepare(
    `SELECT id, path, content_type, storage, r2_key, gdrive_url FROM artifacts WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!row) return error(404, "找不到這個成品");
  if (row.storage === "gdrive") return Response.redirect(row.gdrive_url, 302);
  if (row.storage !== "r2" || !row.r2_key)
    return error(409, "這個成品正在搬移中");

  const object = await env.BUCKET.get(row.r2_key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) return error(404, "R2 上找不到檔案");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", row.content_type);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  if (SANDBOXED_TYPES.test(row.content_type))
    headers.set(
      "content-security-policy",
      "sandbox allow-scripts allow-popups allow-forms",
    );

  const url = new URL(request.url);
  const filename = row.path.split("/").pop();
  headers.set(
    "content-disposition",
    `${url.searchParams.has("dl") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );

  if (!("body" in object)) return new Response(null, { status: 304, headers });

  // 影片播放會送很多 Range 請求，只在從頭讀取時記錄「最後瀏覽時間」
  const range = request.headers.get("range");
  if (!range || /^bytes=0-/.test(range)) {
    ctx.waitUntil(
      env.DB.prepare(
        `UPDATE artifacts SET last_viewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      )
        .bind(id)
        .run(),
    );
  }

  if (range && object.range) {
    const { offset = 0, length, suffix } = object.range;
    const start = suffix !== undefined ? object.size - suffix : offset;
    const end =
      suffix !== undefined
        ? object.size - 1
        : start + (length ?? object.size - start) - 1;
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}

// ---------- 路由 ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const user = await verifyAccess(request, env);
    if (!user) {
      return error(
        401,
        env.ACCESS_AUD
          ? "未登入或沒有權限"
          : "尚未設定 Cloudflare Access，API 暫停服務",
      );
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return error(405, "不支援的方法");

    try {
      const parts = url.pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      if (parts[0] === "files" && parts[1])
        return serveFile(request, env, ctx, Number(parts[1]));

      if (parts[0] === "api") {
        const [, resource, id] = parts;
        if (resource === "me") return json(user);
        if (resource === "projects" && !id)
          return json(await listProjects(env));
        if (resource === "projects" && id) {
          const project = await getProject(env, id);
          return project ? json(project) : error(404, "找不到這個專案");
        }
        if (resource === "artifacts" && id) {
          const artifact = await getArtifact(env, Number(id));
          return artifact ? json(artifact) : error(404, "找不到這個成品");
        }
        if (resource === "search")
          return json(await search(env, url.searchParams.get("q")));
        if (resource === "usage") return json(await usage(env));
      }
      return error(404, "找不到");
    } catch (e) {
      console.error(e);
      return error(500, "伺服器錯誤");
    }
  },
};
