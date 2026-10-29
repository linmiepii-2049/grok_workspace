// JTeam 成品庫前端：無框架，路由 / · /p/:slug · /a/:id · /search?q=
const app = document.getElementById("app");

const KINDS = {
  image: { label: "圖片", glyph: "圖" },
  video: { label: "影片", glyph: "影" },
  html: { label: "HTML", glyph: "頁" },
  copy: { label: "文案", glyph: "文" },
  slides: { label: "簡報", glyph: "簡" },
  other: { label: "其他", glyph: "檔" },
};

// ---------- 工具 ----------

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const bytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : n / 1024 ** i < 10 ? 1 : 0)} ${u[i]}`;
};

const dateFmt = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const date = (s) => (s ? dateFmt.format(new Date(s)) : "—");
const datetime = (s) => (s ? timeFmt.format(new Date(s)) : "—");
const pad = (n) => String(n).padStart(2, "0");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path) {
  const res = await fetch(path, {
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new HttpError(res.status, body.error || `HTTP ${res.status}`);
  return body;
}

async function post(path, data) {
  const res = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, body.error || `HTTP ${res.status}`);
  return body;
}

function toast(text) {
  document.querySelector(".toast")?.remove();
  const el = Object.assign(document.createElement("div"), {
    className: "toast",
    textContent: text,
    role: "status",
  });
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

// 主題：自動 → 淺色 → 深色；只是個人偏好，存取失敗就當作自動
const THEMES = ["auto", "light", "dark"];
const THEME_LABEL = { auto: "自動", light: "淺色", dark: "深色" };
const readTheme = () => {
  try {
    return localStorage.getItem("theme") || "auto";
  } catch {
    return "auto";
  }
};
const applyTheme = (t) => {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
};
applyTheme(readTheme());

function themeButton() {
  return `<button class="theme-toggle" type="button" data-action="theme" aria-label="切換主題，目前${THEME_LABEL[readTheme()]}">${THEME_LABEL[readTheme()]}</button>`;
}

// ---------- 元件 ----------

const searchBox = (q = "") => `
  <form class="search" role="search" data-action="search">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input type="search" name="q" value="${esc(q)}" placeholder="搜尋標題、檔名、文案內容" aria-label="搜尋成品" enterkeyhint="search" />
  </form>`;

function frameMedia(a) {
  const src = `/files/${a.id}`;
  if (a.storage === "gdrive" && a.has_thumb)
    return `<div class="frame-media"><img src="${src}?thumb" alt="" loading="lazy" decoding="async" /></div>`;
  if (a.storage !== "r2")
    return `<div class="frame-media glyph">${KINDS[a.kind].glyph}<small>${a.storage === "gdrive" ? "DRIVE" : "搬移中"}</small></div>`;
  if (a.kind === "image")
    return `<div class="frame-media"><img src="${src}" alt="" loading="lazy" decoding="async" /></div>`;
  if (a.kind === "video")
    return `<div class="frame-media"><video src="${src}#t=0.1" preload="metadata" muted playsinline></video></div>`;
  if (a.kind === "copy" && a.excerpt)
    return `<div class="frame-media text">${esc(a.excerpt)}</div>`;
  const ext = a.path.split(".").pop().toUpperCase();
  return `<div class="frame-media glyph">${KINDS[a.kind].glyph}<small>${esc(ext)}</small></div>`;
}

function frame(a, i, { showProject = false } = {}) {
  const meta = [
    showProject ? a.project_name : null,
    a.versions > 1 ? `v${a.version}` : null,
    bytes(a.size),
  ]
    .filter(Boolean)
    .join(" · ");
  return `
    <a class="frame" href="/a/${a.id}" style="--i:${Math.min(i, 12)}" data-id="${a.id}" data-size="${a.size}" data-storage="${a.storage}">
      <div class="frame-window">
        <span class="frame-no">${pad(i + 1)}</span>
        <span class="frame-kind">${KINDS[a.kind].label}</span>
        ${frameMedia(a)}
        ${a.storage === "gdrive" ? `<span class="badge">☁ Drive</span>` : a.storage === "offloading" ? `<span class="badge">搬移中</span>` : ""}
        <span class="check" aria-hidden="true"></span>
      </div>
      <div class="frame-caption">
        <strong>${esc(a.title)}</strong>
        <span class="mono">${esc(meta)}</span>
      </div>
    </a>`;
}

function usageMeter(u) {
  const pct = u.quota_bytes ? (u.bytes / u.quota_bytes) * 100 : 0;
  const row = (a, right) =>
    `<li><a href="/a/${a.id}"><span>${esc(a.title)} <span class="mono">${esc(a.project_name)}</span></span><span class="mono">${right}</span></a></li>`;
  return `
    <section class="meter ${pct >= 80 ? "warn" : ""}" aria-label="R2 用量">
      <div class="meter-head">
        <span class="mono">R2 ${bytes(u.bytes)} / ${bytes(u.quota_bytes)}</span>
        <span class="mono">${pct < 0.1 && u.bytes > 0 ? "<0.1" : pct.toFixed(1)}%</span>
      </div>
      <div class="meter-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(1)}">
        <div class="meter-fill" style="width:${Math.max(pct, u.bytes ? 0.8 : 0)}%"></div>
      </div>
      <details class="usage">
        <summary>${u.objects} 個檔案在 R2 · 查看最大與最久沒看的 ›</summary>
        <div class="usage-cols">
          <div><h3>最大</h3><ol>${u.largest.map((a) => row(a, bytes(a.size))).join("")}</ol></div>
          <div><h3>最久沒看</h3><ol>${u.stalest.map((a) => row(a, a.last_viewed_at ? date(a.last_viewed_at) : "沒看過")).join("")}</ol></div>
        </div>
      </details>
    </section>`;
}

const JOB_STATUS = {
  queued: "排隊中",
  running: "搬移中",
  done: "完成",
  failed: "有失敗",
};

function driveCard(drive, jobs) {
  let body;
  if (!drive.configured)
    body = `<p class="mono">Google OAuth 尚未設定，見 docs/cloud-setup.md 第 7 節</p>`;
  else if (!drive.connected)
    body = `<p>連結後，可以把成品移到 Google Drive，釋出 R2 空間。</p><a class="btn primary" href="/api/gdrive/connect" data-external>連結 Google Drive</a>`;
  else
    body = `<p class="mono">已連結 ${esc(drive.account)} · 檔案放在 Drive 的「JTeam」資料夾</p>
      <a class="btn" href="/api/gdrive/connect" data-external>重新連結</a>`;
  const jobRows = jobs
    .map((j) => {
      const pct = j.total
        ? Math.round(((j.done_count + j.failed_count) / j.total) * 100)
        : 0;
      return `<li class="job ${j.status}">
        <div class="job-head"><span>${JOB_STATUS[j.status]} · ${j.done_count}/${j.total} 件${j.failed_count ? ` · 失敗 ${j.failed_count}` : ""}</span><span class="mono">${datetime(j.created_at)}</span></div>
        ${j.status === "running" || j.status === "queued" ? `<div class="meter-bar"><div class="meter-fill" style="width:${Math.max(pct, 3)}%"></div></div>` : ""}
        ${j.error ? `<pre class="job-error">${esc(j.error)}</pre>` : ""}
      </li>`;
    })
    .join("");
  return `
    <section class="drive" aria-label="Google Drive">
      <div class="section-label"><h2>Google Drive</h2></div>
      ${body}
      ${jobRows ? `<ol class="jobs">${jobRows}</ol>` : ""}
    </section>`;
}

// 有搬移進行中時，每 4 秒重新整理首頁的進度
let pollTimer = null;
function pollJobs(jobs) {
  clearTimeout(pollTimer);
  if (jobs.some((j) => j.status === "running" || j.status === "queued"))
    pollTimer = setTimeout(
      () => location.pathname === "/" && render({ keepScroll: true }),
      4000,
    );
}

// 確認搬移：先問伺服器實際會搬幾件、多大
async function confirmOffload(body, label) {
  const preview = await post("/api/offload/preview", body);
  if (!preview.count) return toast("沒有可搬移的成品（可能已在 Drive）");
  if (preview.count > preview.max)
    return toast(`一次最多搬 ${preview.max} 件，目前 ${preview.count} 件`);
  const dialog = document.getElementById("confirm");
  dialog.querySelector(".confirm-text").innerHTML = `
    <p>${esc(label)}：<strong>${preview.count} 件、${bytes(preview.bytes)}</strong></p>
    <p>會上傳到 Google Drive 的「JTeam」資料夾，<strong>檔案驗證一致後，就從 R2 刪除</strong>。驗證失敗的會留在 R2。</p>
    <p class="mono">之後在 Drive 刪掉就救不回來了。</p>`;
  dialog.showModal();
  const ok = await new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "ok"),
      { once: true },
    ),
  );
  if (!ok) return;
  const job = await post("/api/offload", body);
  toast(`已開始搬移 ${job.count} 件`);
  navigate("/");
}

// ---------- 頁面 ----------

async function homePage() {
  const [projects, u, drive, jobs] = await Promise.all([
    api("/api/projects"),
    api("/api/usage"),
    api("/api/gdrive/status"),
    api("/api/offload/jobs"),
  ]);
  const total = projects.reduce((s, p) => s + p.artifacts, 0);
  document.title = "JTeam 成品庫";
  pollJobs(jobs);
  return `
    <div class="topbar"><span class="mono">JTEAM / ARCHIVE</span><span class="topbar-end"><a class="back" href="/portfolio">投資追蹤 →</a>${themeButton()}</span></div>
    <header class="masthead">
      <h1>成品庫<span class="dot">.</span></h1>
      <span class="mono">${projects.length} 個專案 · ${total} 件成品</span>
    </header>
    ${searchBox()}
    ${usageMeter(u)}
    <div class="section-label"><h2>專案</h2><span class="mono">依最近更新</span></div>
    ${
      projects.length
        ? `<div class="projects">${projects
            .map(
              (p, i) => `
          <a class="project" href="/p/${encodeURIComponent(p.slug)}" style="--i:${i}">
            <div class="filmstrip">${p.cover_id ? `<img src="/files/${p.cover_id}" alt="" loading="lazy" />` : `<span class="empty">${esc(p.name.slice(0, 1))}</span>`}</div>
            <div class="project-body">
              <h3>${esc(p.name)}</h3>
              <span class="mono">${p.artifacts} 件 · R2 ${bytes(p.r2_bytes)} · ${date(p.last_artifact_at || p.updated_at)}</span>
            </div>
          </a>`,
            )
            .join("")}</div>`
        : `<p class="empty-state">還沒有專案。在 Claude Code 執行 <code>npm run jt -- new &lt;slug&gt; "名稱"</code> 建立第一個。</p>`
    }
    ${driveCard(drive, jobs)}`;
}

let driveConnected = false;

async function projectPage(slug, kind) {
  const [p, drive] = await Promise.all([api(`/api/projects/${encodeURIComponent(slug)}`), api("/api/gdrive/status")]);
  driveConnected = drive.connected;
  document.title = `${p.name} · JTeam`;
  const counts = p.artifacts.reduce((m, a) => ((m[a.kind] = (m[a.kind] || 0) + 1), m), {});
  const shown = kind ? p.artifacts.filter((a) => a.kind === kind) : p.artifacts;
  const inR2 = p.artifacts.some((a) => a.storage === "r2");
  const chip = (k, label, n) =>
    `<button class="chip" type="button" data-action="filter" data-kind="${k}" aria-pressed="${(kind || "") === k}">${label}<span class="n">${n}</span></button>`;
  return `
    <div class="topbar"><a class="back" href="/">← 全部專案</a>${themeButton()}</div>
    <header class="project-head">
      <span class="mono">${esc(p.slug)}</span>
      <h1>${esc(p.name)}</h1>
      <span class="mono">${p.artifacts.length} 件成品 · 建立於 ${date(p.created_at)}</span>
    </header>
    <nav class="chips" aria-label="依類型篩選">
      ${chip("", "全部", p.artifacts.length)}
      ${Object.keys(KINDS)
        .filter((k) => counts[k])
        .map((k) => chip(k, KINDS[k].label, counts[k]))
        .join("")}
      ${drive.connected && inR2 ? `<button class="chip select-toggle" type="button" data-action="select" aria-pressed="false">選取</button>` : ""}
    </nav>
    ${shown.length ? `<div class="sheet" data-project="${esc(p.slug)}">${shown.map((a, i) => frame(a, i)).join("")}</div>` : `<p class="empty-state">這個類型沒有成品</p>`}
    <div class="selectbar" hidden>
      <span class="selectbar-info mono">已選 0 件</span>
      <button class="btn" type="button" data-action="offload-project">整個專案</button>
      <button class="btn primary" type="button" data-action="offload-selected" disabled>移到 Drive</button>
    </div>`;
}

function stage(a) {
  const src = `/files/${a.id}`;
  if (a.storage === "gdrive")
    return `<div class="stage"><div class="placeholder">
      ${a.has_thumb ? `<img src="${src}?thumb" alt="${esc(a.title)}（縮圖）" style="margin:0 auto 16px" />` : ""}
      這個成品已移到 Google Drive<br/><span class="drive-check">確認 Drive 檔案…</span><br/><br/>
      <a class="btn primary" href="${esc(a.gdrive_url)}" target="_blank" rel="noopener">在 Drive 開啟</a></div></div>`;
  if (a.storage !== "r2") return `<div class="stage"><div class="placeholder">正在搬移到 Google Drive…</div></div>`;
  switch (a.kind) {
    case "image":
      return `<div class="stage"><img src="${src}" alt="${esc(a.title)}" /></div>`;
    case "video":
      return `<div class="stage"><video src="${src}" controls playsinline preload="metadata"></video></div>`;
    case "html":
    case "slides":
      if (/html/.test(a.content_type))
        return `<div class="stage"><iframe src="${src}" title="${esc(a.title)}" sandbox="allow-scripts allow-popups allow-forms" loading="lazy"></iframe></div>`;
      return `<div class="stage"><div class="placeholder">${esc(a.path.split(".").pop().toUpperCase())} 檔無法在瀏覽器預覽，請下載後開啟</div></div>`;
    case "copy":
      return a.body !== null
        ? `<div class="stage copy"><div class="copy-body">${esc(a.body)}</div></div>`
        : `<div class="stage"><div class="placeholder">檔案太大，請下載閱讀</div></div>`;
    default:
      return `<div class="stage"><div class="placeholder">無法預覽，請下載</div></div>`;
  }
}

function artifactPage(a, drive) {
  document.title = `${a.title} · JTeam`;
  const filename = a.path.split("/").pop();
  return `
    <div class="topbar"><a class="back" href="/p/${encodeURIComponent(a.project_slug)}">← ${esc(a.project_name)}</a>${themeButton()}</div>
    <header class="artifact-head">
      <span class="mono">${KINDS[a.kind].label} · v${a.version} · ${bytes(a.size)}</span>
      <h1>${esc(a.title)}</h1>
    </header>
    ${stage(a)}
    <div class="actions">
      ${a.storage === "r2" ? `<a class="btn primary" href="/files/${a.id}?dl=1" download="${esc(filename)}">下載</a>` : ""}
      ${a.storage === "r2" ? `<a class="btn" href="/files/${a.id}" target="_blank" rel="noopener">開新分頁</a>` : ""}
      ${a.kind === "copy" && a.body !== null ? `<button class="btn" type="button" data-action="copy">複製文字</button>` : ""}
      ${a.storage === "r2" && drive.connected ? `<button class="btn" type="button" data-action="offload-one">移到 Google Drive</button>` : ""}
    </div>
    ${
      a.versions.length > 1
        ? `<h2 class="small">版本</h2><nav class="versions" aria-label="版本">${a.versions
            .map((v) => `<a href="/a/${v.id}" aria-current="${v.id === a.id}">v${v.version}${v.storage === "gdrive" ? " ☁" : ""}</a>`)
            .join("")}</nav>`
        : ""
    }
    <h2 class="small">資訊</h2>
    <dl class="info">
      <dt>路徑</dt><dd>${esc(a.project_slug)}/outputs/${esc(a.path)}</dd>
      <dt>建立</dt><dd>${datetime(a.created_at)}</dd>
      <dt>大小</dt><dd>${bytes(a.size)}</dd>
      <dt>存放</dt><dd>${a.storage === "r2" ? "Cloudflare R2" : a.storage === "gdrive" ? `Google Drive（${datetime(a.offloaded_at)} 移出）` : "搬移中"}</dd>
      ${a.git_commit ? `<dt>commit</dt><dd class="mono">${esc(a.git_commit.slice(0, 7))}${a.meta.branch ? ` · ${esc(a.meta.branch)}` : ""}</dd>` : ""}
      <dt>sha256</dt><dd class="mono">${esc(a.sha256.slice(0, 16))}…</dd>
    </dl>`;
}

// Drive 上的檔案可能被手動刪掉：開啟成品頁時確認一次
async function checkDriveFile(a) {
  const el = document.querySelector(".drive-check");
  if (!el) return;
  try {
    const { exists } = await api(`/api/gdrive/check/${a.id}`);
    el.textContent = exists === false ? "⚠ Drive 上找不到這個檔案（可能已被刪除或移到垃圾桶）" : exists ? "✓ Drive 檔案存在" : "無法確認 Drive 檔案";
    if (exists === false) el.classList.add("missing");
  } catch {
    el.textContent = "無法確認 Drive 檔案";
  }
}

async function searchPage(q) {
  const results = q ? await api(`/api/search?q=${encodeURIComponent(q)}`) : [];
  document.title = `搜尋：${q} · JTeam`;
  return `
    <div class="topbar"><a class="back" href="/">← 全部專案</a>${themeButton()}</div>
    ${searchBox(q)}
    <div class="section-label"><h2>搜尋結果</h2><span class="mono">${results.length} 件</span></div>
    ${results.length ? `<div class="sheet">${results.map((a, i) => frame(a, i, { showProject: true })).join("")}</div>` : `<p class="empty-state">找不到符合「${esc(q)}」的成品</p>`}`;
}

function errorPage(e) {
  if (e.status === 401)
    return `<div class="notice"><div class="big">401</div><h1>沒有存取權限</h1><p>${esc(e.message)}</p><p class="mono">請重新整理，用 linmiepii@gmail.com 登入</p></div>`;
  if (e.status === 404)
    return `<div class="notice"><div class="big">404</div><h1>${esc(e.message)}</h1><p><a class="btn" href="/">回到成品庫</a></p></div>`;
  return `<div class="notice"><div class="big">!</div><h1>載入失敗</h1><p>${esc(e.message)}</p><p><button class="btn" type="button" data-action="reload">重試</button></p></div>`;
}

// ---------- 路由 ----------

let current = null; // 目前成品，給「複製文字」與搬移用

async function render({ keepScroll = false } = {}) {
  const url = new URL(location.href);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!keepScroll) app.innerHTML = `<div class="loading" aria-label="載入中"><span></span></div>`;
  current = null;
  clearTimeout(pollTimer);

  // 從 Google 授權頁回來
  const driveResult = url.searchParams.get("drive");
  if (driveResult) {
    toast(driveResult === "connected" ? "已連結 Google Drive" : `連結失敗：${url.searchParams.get("msg") || "未知錯誤"}`);
    history.replaceState(null, "", url.pathname);
  }

  try {
    let html;
    if (parts.length === 0) html = await homePage();
    else if (parts[0] === "p" && parts[1]) html = await projectPage(parts[1], url.searchParams.get("kind"));
    else if (parts[0] === "a" && /^\d+$/.test(parts[1] || "")) {
      const [a, drive] = await Promise.all([api(`/api/artifacts/${parts[1]}`), api("/api/gdrive/status")]);
      current = a;
      html = artifactPage(a, drive);
    } else if (parts[0] === "search") html = await searchPage(url.searchParams.get("q") || "");
    else throw new HttpError(404, "找不到這個頁面");
    app.innerHTML = html;
    if (current?.storage === "gdrive") checkDriveFile(current);
  } catch (e) {
    app.innerHTML = errorPage(e);
  }
  if (!keepScroll) window.scrollTo(0, 0);
}

function navigate(href, { replace = false } = {}) {
  history[replace ? "replaceState" : "pushState"](null, "", href);
  render();
}

// ---------- 選取模式（專案頁） ----------

const selected = new Map(); // id → size

function updateSelectbar() {
  const bar = document.querySelector(".selectbar");
  if (!bar) return;
  const total = [...selected.values()].reduce((s, n) => s + n, 0);
  bar.querySelector(".selectbar-info").textContent = `已選 ${selected.size} 件 · ${bytes(total)}`;
  bar.querySelector('[data-action="offload-selected"]').disabled = selected.size === 0;
}

function setSelectMode(on) {
  selected.clear();
  document.querySelector(".sheet")?.classList.toggle("selecting", on);
  document.querySelectorAll(".frame.selected").forEach((f) => f.classList.remove("selected"));
  const toggle = document.querySelector(".select-toggle");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(on));
    toggle.textContent = on ? "取消選取" : "選取";
  }
  const bar = document.querySelector(".selectbar");
  if (bar) bar.hidden = !on;
  updateSelectbar();
}

async function runAction(fn) {
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  }
}

document.addEventListener("click", (e) => {
  // 選取模式下點格子是勾選，不是開啟
  const tile = e.target.closest(".sheet.selecting .frame");
  if (tile) {
    e.preventDefault();
    if (tile.dataset.storage !== "r2") return toast("這件已在 Drive 或搬移中");
    const id = Number(tile.dataset.id);
    if (selected.has(id)) selected.delete(id);
    else selected.set(id, Number(tile.dataset.size));
    tile.classList.toggle("selected", selected.has(id));
    updateSelectbar();
    return;
  }

  const link = e.target.closest("a[href]");
  if (
    link &&
    link.origin === location.origin &&
    !link.target &&
    !link.hasAttribute("download") &&
    !link.hasAttribute("data-external") &&
    !e.metaKey &&
    !e.ctrlKey &&
    !link.pathname.startsWith("/files/") &&
    !link.pathname.startsWith("/api/")
  ) {
    e.preventDefault();
    navigate(link.pathname + link.search);
    return;
  }
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "theme") {
    const next = THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length];
    try {
      localStorage.setItem("theme", next);
    } catch {}
    applyTheme(next);
    document.querySelectorAll(".theme-toggle").forEach((b) => {
      b.textContent = THEME_LABEL[next];
      b.setAttribute("aria-label", `切換主題，目前${THEME_LABEL[next]}`);
    });
  } else if (action === "filter") {
    const url = new URL(location.href);
    if (btn.dataset.kind) url.searchParams.set("kind", btn.dataset.kind);
    else url.searchParams.delete("kind");
    navigate(url.pathname + url.search, { replace: true });
  } else if (action === "copy" && current?.body) {
    navigator.clipboard.writeText(current.body).then(
      () => toast("已複製"),
      () => toast("複製失敗，請長按文字手動複製"),
    );
  } else if (action === "select") {
    setSelectMode(btn.getAttribute("aria-pressed") !== "true");
  } else if (action === "offload-selected") {
    runAction(() => confirmOffload({ ids: [...selected.keys()] }, "選取的成品"));
  } else if (action === "offload-project") {
    const slug = document.querySelector(".sheet")?.dataset.project;
    runAction(() => confirmOffload({ project: slug }, "整個專案（含所有舊版本）"));
  } else if (action === "offload-one" && current) {
    runAction(() => confirmOffload({ ids: [current.id] }, `「${current.title}」v${current.version}`));
  } else if (action === "reload") {
    render();
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest('[data-action="search"]');
  if (!form) return;
  e.preventDefault();
  const q = new FormData(form).get("q").toString().trim();
  if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
});

window.addEventListener("popstate", () => render());
render();
