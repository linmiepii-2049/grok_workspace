// jteam-viewer Worker：/api/* 回傳 D1 資料，/files/* 從 R2 串流成品；其餘由靜態資源處理
// 每個請求都驗證 Cloudflare Access 的 JWT：就算有人繞過 Access（例如設定被關掉），也拿不到資料
import * as gdrive from "./gdrive.js";

export { OffloadWorkflow } from "./offload.js";

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
  a.thumb_key IS NOT NULL AS has_thumb, substr(a.body, 1, 160) AS excerpt,
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
            a.storage, a.gdrive_url, a.gdrive_file_id, a.offloaded_at, a.thumb_key IS NOT NULL AS has_thumb, a.created_at, a.meta, p.slug AS project_slug, p.name AS project_name
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

// ---------- 投資追蹤（資料由 tools/portfolio 排程寫入）----------

async function portfolioSummary(env) {
  const [{ results: series }, latest, { results: realized }] =
    await Promise.all([
      env.DB.prepare(
        `SELECT date, total, market_value, cash, cost, unrealized, realized_cum, income_cum, net_flow, twr, bench, fx_usd FROM pf_snapshots ORDER BY date`,
      ).all(),
      env.DB.prepare(
        `SELECT date, positions, cash_by_ccy FROM pf_snapshots ORDER BY date DESC LIMIT 1`,
      ).first(),
      env.DB.prepare(
        `SELECT date, symbol, account, shares, proceeds, cost, pnl, pnl_price, pnl_fx FROM pf_realized ORDER BY date DESC, id DESC`,
      ).all(),
    ]);
  return {
    series: series.map((s) => ({ ...s, bench: JSON.parse(s.bench) })),
    positions: latest ? JSON.parse(latest.positions) : [],
    cash_by_ccy: latest ? JSON.parse(latest.cash_by_ccy) : {},
    realized,
  };
}

async function portfolioEvents(env, days) {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT date, kind, symbol, title, detail FROM pf_events WHERE date >= ? AND date <= date(?, '+' || ? || ' days') ORDER BY date, kind, title`,
  )
    .bind(today, today, Math.min(Math.max(days, 1), 120))
    .all();
  return results;
}

async function portfolioNews(env, symbol) {
  const { results } = await env.DB.prepare(
    `SELECT url, symbol, title, source, summary, published_at FROM pf_news WHERE (?1 IS NULL OR symbol = ?1) ORDER BY published_at DESC LIMIT 30`,
  )
    .bind(symbol || null)
    .all();
  return results;
}

async function portfolioBriefs(env, date) {
  if (date)
    return env.DB.prepare(
      `SELECT date, title, body, model, created_at FROM pf_briefs WHERE date = ?`,
    )
      .bind(date)
      .first();
  const { results } = await env.DB.prepare(
    `SELECT date, title FROM pf_briefs ORDER BY date DESC LIMIT 60`,
  ).all();
  return results;
}

async function handlePortfolio(env, url, action, id) {
  if (action === "summary") return json(await portfolioSummary(env));
  if (action === "events")
    return json(
      await portfolioEvents(env, Number(url.searchParams.get("days")) || 30),
    );
  if (action === "news")
    return json(await portfolioNews(env, url.searchParams.get("symbol")));
  if (action === "briefs") {
    const brief = await portfolioBriefs(env, id);
    return brief ? json(brief) : error(404, "找不到這天的晨報");
  }
  return error(404, "找不到");
}

// ---------- 檔案 ----------

// 使用者的 HTML / SVG 和瀏覽頁同網域：用 CSP sandbox 讓它變成獨立來源，碰不到 Access cookie 與 API
const SANDBOXED_TYPES = /^(text\/html|image\/svg\+xml)/;

async function serveFile(request, env, ctx, id) {
  const row = await env.DB.prepare(
    `SELECT id, path, content_type, storage, r2_key, thumb_key, gdrive_url FROM artifacts WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!row) return error(404, "找不到這個成品");
  const url = new URL(request.url);
  // 已搬到 Drive 的圖片仍保留縮圖
  if (url.searchParams.has("thumb") && row.thumb_key) {
    const thumb = await env.BUCKET.get(row.thumb_key);
    if (thumb)
      return new Response(thumb.body, {
        headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400" },
      });
  }
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

// ---------- 搬到 Google Drive ----------

// 一個 Workflow 有步驟上限，每件成品約 7 步加上分段數；100 件留足餘裕
const MAX_OFFLOAD = 100;

// 選取要搬的成品：指定 id，或整個專案（含所有版本）；只取還在 R2 的
async function selectForOffload(env, body) {
  if (body.project) {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.size FROM artifacts a JOIN projects p ON p.id = a.project_id WHERE p.slug = ? AND a.storage = 'r2'`,
    )
      .bind(String(body.project))
      .all();
    return results;
  }
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger);
  if (!ids.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, size FROM artifacts WHERE storage = 'r2' AND id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(ids))
    .all();
  return results;
}

async function offloadPreview(env, body) {
  const rows = await selectForOffload(env, body);
  return { count: rows.length, bytes: rows.reduce((s, r) => s + r.size, 0), max: MAX_OFFLOAD };
}

async function startOffload(env, body) {
  const drive = await gdrive.status(env);
  if (!drive.connected) return error(409, "尚未連結 Google Drive");
  const rows = await selectForOffload(env, body);
  if (!rows.length) return error(400, "沒有可搬移的成品");
  if (rows.length > MAX_OFFLOAD) return error(400, `一次最多搬 ${MAX_OFFLOAD} 件，目前選了 ${rows.length} 件`);

  // 原子地把狀態改成搬移中：同時按兩次也只會有一個 Workflow 處理同一件
  const { results } = await env.DB.prepare(
    `UPDATE artifacts SET storage = 'offloading' WHERE storage = 'r2' AND id IN (SELECT value FROM json_each(?)) RETURNING id, size`,
  )
    .bind(JSON.stringify(rows.map((r) => r.id)))
    .all();
  if (!results.length) return error(409, "這些成品已在搬移中");
  const ids = results.map((r) => r.id);
  const jobId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO offload_jobs (id, artifact_ids) VALUES (?, ?)`).bind(jobId, JSON.stringify(ids)).run();

  try {
    await env.OFFLOAD.create({ id: jobId, params: { jobId, artifactIds: ids } });
  } catch (e) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE artifacts SET storage = 'r2' WHERE storage = 'offloading' AND id IN (SELECT value FROM json_each(?))`).bind(
        JSON.stringify(ids),
      ),
      env.DB.prepare(`UPDATE offload_jobs SET status = 'failed', error = ? WHERE id = ?`).bind(`無法啟動：${e.message}`, jobId),
    ]);
    throw e;
  }
  return json({ job_id: jobId, count: ids.length, bytes: results.reduce((s, r) => s + r.size, 0) }, { status: 202 });
}

async function listJobs(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, status, json_array_length(artifact_ids) AS total, done_count, failed_count, error, created_at, finished_at
     FROM offload_jobs ORDER BY created_at DESC LIMIT 10`,
  ).all();
  return results;
}

// ---------- 路由 ----------

const STATE_COOKIE = "gd_state";

function readCookie(request, name) {
  const match = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ?? null;
}

async function handleGdrive(request, env, url, action, id) {
  if (action === "status") return json(await gdrive.status(env));
  if (!gdrive.driveConfigured(env)) return error(503, "尚未設定 Google OAuth（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / TOKEN_KEY）");

  if (action === "connect") {
    const state = crypto.randomUUID();
    return new Response(null, {
      status: 302,
      headers: {
        location: gdrive.authUrl(env, url.origin, state),
        "set-cookie": `${STATE_COOKIE}=${state}; Path=/api/gdrive; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      },
    });
  }

  if (action === "callback") {
    const back = (q) =>
      new Response(null, {
        status: 302,
        headers: { location: `/?${q}`, "set-cookie": `${STATE_COOKIE}=; Path=/api/gdrive; Max-Age=0` },
      });
    const state = url.searchParams.get("state");
    if (!state || state !== readCookie(request, STATE_COOKIE)) return back("drive=error&msg=" + encodeURIComponent("驗證失敗，請重試"));
    if (url.searchParams.get("error")) return back("drive=error&msg=" + encodeURIComponent(url.searchParams.get("error")));
    try {
      await gdrive.connect(env, url.origin, url.searchParams.get("code"));
      return back("drive=connected");
    } catch (e) {
      return back("drive=error&msg=" + encodeURIComponent(e.message));
    }
  }

  if (action === "check" && id) {
    const row = await env.DB.prepare(`SELECT gdrive_file_id FROM artifacts WHERE id = ? AND storage = 'gdrive'`).bind(Number(id)).first();
    if (!row) return error(404, "這個成品不在 Drive");
    try {
      return json({ exists: await gdrive.fileExists(env, row.gdrive_file_id) });
    } catch (e) {
      return json({ exists: null, error: e.message });
    }
  }
  return error(404, "找不到");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const user = await verifyAccess(request, env);
    if (!user) {
      return error(401, env.ACCESS_AUD ? "未登入或沒有權限" : "尚未設定 Cloudflare Access，API 暫停服務");
    }

    const isWrite = request.method === "POST";
    if (!isWrite && request.method !== "GET" && request.method !== "HEAD") return error(405, "不支援的方法");
    // 寫入只接受同源 JSON：跨站表單送不出 application/json，加上 Origin 檢查擋 CSRF
    if (isWrite && (request.headers.get("origin") !== url.origin || !request.headers.get("content-type")?.startsWith("application/json"))) {
      return error(403, "拒絕跨站請求");
    }

    try {
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] === "files" && parts[1] && !isWrite) return serveFile(request, env, ctx, Number(parts[1]));

      if (parts[0] === "api") {
        const [, resource, id, sub] = parts;
        if (isWrite) {
          const body = await request.json().catch(() => ({}));
          if (resource === "offload" && id === "preview") return json(await offloadPreview(env, body));
          if (resource === "offload" && !id) return startOffload(env, body);
          return error(404, "找不到");
        }
        if (resource === "me") return json(user);
        if (resource === "projects" && !id) return json(await listProjects(env));
        if (resource === "projects" && id) {
          const project = await getProject(env, id);
          return project ? json(project) : error(404, "找不到這個專案");
        }
        if (resource === "artifacts" && id) {
          const artifact = await getArtifact(env, Number(id));
          return artifact ? json(artifact) : error(404, "找不到這個成品");
        }
        if (resource === "search") return json(await search(env, url.searchParams.get("q")));
        if (resource === "usage") return json(await usage(env));
        if (resource === "gdrive") return handleGdrive(request, env, url, id, sub);
        if (resource === "offload" && id === "jobs") return json(await listJobs(env));
        if (resource === "portfolio") return handlePortfolio(env, url, id, sub);
      }
      return error(404, "找不到");
    } catch (e) {
      console.error(e);
      return error(500, "伺服器錯誤");
    }
  },
};
