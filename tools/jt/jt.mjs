#!/usr/bin/env node
// jt：JT-Projects 的專案與成品歸檔工具
//   jt new <slug> "<名稱>"        建立 projects/<yyyy-mm>-<slug>/
//   jt archive [--dry-run]        把 outputs/ 的成品上傳 R2、寫入 D1（已歸檔的會略過）
//   jt check [--hook]             列出還沒歸檔的大檔；--hook 給 Claude Code Stop hook 用
// 雲端與 CI 需要環境變數 CLOUDFLARE_API_TOKEN；Mac 上可直接用 wrangler login 的身分
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const PROJECTS = join(ROOT, "projects");
const WRANGLER_CONFIG = join(ROOT, "infra/wrangler.jsonc");
const DB = "jteam";
const BUCKET = "jteam";
// 超過這個大小的檔案不該進 git：GitHub 單檔 100MB 硬上限，20MB 以上就會讓手機端 clone 變慢
const GIT_SIZE_LIMIT = 20 * 1024 * 1024;
// wrangler r2 object put 的單檔上限是 315MB，更大的要改走 multipart（P4 的 viewer 上傳端點）
const WRANGLER_UPLOAD_LIMIT = 300 * 1024 * 1024;
// 文案存進 D1 供搜尋；過大的文字檔只存 R2
const BODY_LIMIT = 512 * 1024;
const POINTER_EXT = ".r2.json";

const KIND_BY_EXT = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic"],
  video: ["mp4", "mov", "webm", "mkv", "m4v"],
  html: ["html", "htm"],
  copy: ["md", "txt"],
  slides: ["pptx", "key"],
};
const CONTENT_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", avif: "image/avif", heic: "image/heic",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", m4v: "video/x-m4v",
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  key: "application/x-iwork-keynote-sffkey", pdf: "application/pdf", json: "application/json",
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", zip: "application/zip",
};

const die = (msg) => {
  console.error(`✘ ${msg}`);
  process.exit(1);
};

// ---------- 共用 ----------

const ext = (file) => extname(file).slice(1).toLowerCase();

const kindOf = (relPath) => {
  if (relPath.endsWith(".slides.html") || relPath.startsWith("slides/")) return "slides";
  const e = ext(relPath);
  return Object.keys(KIND_BY_EXT).find((k) => KIND_BY_EXT[k].includes(e)) ?? "other";
};

const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
    : [];

const hashFile = (file) =>
  new Promise((resolve, reject) => {
    const sha = createHash("sha256");
    const md5 = createHash("md5");
    createReadStream(file)
      .on("data", (chunk) => {
        sha.update(chunk);
        md5.update(chunk);
      })
      .on("end", () => resolve({ sha256: sha.digest("hex"), md5: md5.digest("hex") }))
      .on("error", reject);
  });

const isGitIgnored = (file) => {
  try {
    execFileSync("git", ["check-ignore", "-q", file], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
};

const gitCommit = () => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

const gitBranch = () => {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

const readProject = (dir) => {
  const file = join(PROJECTS, dir, "project.json");
  if (!existsSync(file)) return null;
  const p = JSON.parse(readFileSync(file, "utf8"));
  return { slug: dir, name: p.name ?? dir, status: p.status ?? "active", tags: p.tags ?? [] };
};

// 掃描所有成品；略過指標檔與 .gitkeep
const scanOutputs = () =>
  (existsSync(PROJECTS) ? readdirSync(PROJECTS) : [])
    .map(readProject)
    .filter(Boolean)
    .flatMap((project) => {
      const outDir = join(PROJECTS, project.slug, "outputs");
      return walk(outDir)
        .filter((f) => !f.endsWith(POINTER_EXT) && basename(f) !== ".gitkeep" && basename(f) !== ".DS_Store")
        .map((file) => ({ project, file, path: relative(outDir, file), size: statSync(file).size }));
    });

const readPointer = (file) => {
  try {
    return JSON.parse(readFileSync(file + POINTER_EXT, "utf8"));
  } catch {
    return null;
  }
};

// ---------- Cloudflare ----------

const wranglerBin = () => {
  const local = join(ROOT, "node_modules/.bin/wrangler");
  return existsSync(local) ? local : "wrangler";
};

const wrangler = (args, opts = {}) =>
  execFileSync(wranglerBin(), [...args, "-c", WRANGLER_CONFIG], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });

const sql = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

const d1Query = (query) => {
  const out = wrangler(["d1", "execute", DB, "--remote", "--json", "--command", query]);
  return JSON.parse(out)[0].results;
};

const d1ExecFile = (statements) => {
  const dir = join(tmpdir(), "jt");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `archive-${process.pid}.sql`);
  writeFileSync(file, statements.join("\n"));
  wrangler(["d1", "execute", DB, "--remote", "--yes", "--file", file]);
};

const r2Key = (slug, relPath, sha256) => {
  const e = extname(relPath);
  const stem = relPath.slice(0, relPath.length - e.length);
  return `projects/${slug}/${stem}@${sha256.slice(0, 8)}${e.toLowerCase()}`;
};

// ---------- 指令 ----------

function cmdNew([slug, name]) {
  if (!slug || !name) die('用法：jt new <slug> "<名稱>"');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) die(`slug 只能用小寫英數與連字號：${slug}`);
  const now = new Date();
  const dir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${slug}`;
  const path = join(PROJECTS, dir);
  if (existsSync(path)) die(`已存在：projects/${dir}`);
  mkdirSync(join(path, "outputs"), { recursive: true });
  writeFileSync(join(path, "outputs/.gitkeep"), "");
  writeFileSync(join(path, "project.json"), JSON.stringify({ name, status: "active", tags: [] }, null, 2) + "\n");
  console.log(`✔ 已建立 projects/${dir}/，成品請放 projects/${dir}/outputs/`);
}

async function cmdArchive(flags) {
  const dryRun = flags.includes("--dry-run");
  const items = scanOutputs();
  if (items.length === 0) return console.log("沒有任何成品");

  // 已歸檔的（含已搬到 Drive 的）以 專案+路徑+sha256 判斷，不重傳
  if (process.env.CI && !process.env.CLOUDFLARE_API_TOKEN) die("缺少 CLOUDFLARE_API_TOKEN，請在 GitHub repo 的 Secrets 設定");
  const existing = new Set(
    d1Query("SELECT p.slug, a.path, a.sha256 FROM artifacts a JOIN projects p ON p.id = a.project_id").map(
      (r) => `${r.slug}\u0000${r.path}\u0000${r.sha256}`,
    ),
  );

  const commit = gitCommit();
  const branch = gitBranch();
  const source = process.env.GITHUB_ACTIONS ? "actions" : "session";
  const statements = [];
  const projectsSeen = new Map();
  const pointers = [];
  let uploaded = 0;
  let skipped = 0;

  for (const item of items) {
    const { project, file, path, size } = item;
    const { sha256, md5 } = await hashFile(file);
    if (existing.has(`${project.slug}\u0000${path}\u0000${sha256}`)) {
      skipped++;
      continue;
    }
    if (size > WRANGLER_UPLOAD_LIMIT) {
      console.error(`⚠ 略過 ${project.slug}/${path}：${(size / 1048576).toFixed(0)}MB 超過目前上傳上限 300MB`);
      continue;
    }

    const kind = kindOf(path);
    const key = r2Key(project.slug, path, sha256);
    const contentType = CONTENT_TYPES[ext(path)] ?? "application/octet-stream";
    const body = kind === "copy" && size <= BODY_LIMIT ? readFileSync(file, "utf8") : null;

    console.log(`${dryRun ? "[dry-run] " : ""}↑ ${project.slug}/${path} → r2://${BUCKET}/${key}`);
    if (!dryRun) wrangler(["r2", "object", "put", `${BUCKET}/${key}`, "--remote", "--file", file, "--content-type", contentType]);

    projectsSeen.set(project.slug, project);
    statements.push(
      `INSERT OR IGNORE INTO artifacts (project_id, kind, title, path, version, content_type, size, sha256, md5, git_commit, body, storage, r2_key, meta)
SELECT p.id, ${sql(kind)}, ${sql(basename(path, extname(path)))}, ${sql(path)},
       COALESCE((SELECT MAX(version) FROM artifacts WHERE project_id = p.id AND path = ${sql(path)}), 0) + 1,
       ${sql(contentType)}, ${size}, ${sql(sha256)}, ${sql(md5)}, ${sql(commit)}, ${sql(body)}, 'r2', ${sql(key)},
       ${sql(JSON.stringify({ source, branch }))}
FROM projects p WHERE p.slug = ${sql(project.slug)};`,
    );
    if (isGitIgnored(file)) pointers.push({ file, pointer: { r2_key: key, sha256, size, archived_at: new Date().toISOString() } });
    uploaded++;
  }

  if (statements.length && !dryRun) {
    const upserts = [...projectsSeen.values()].map(
      (p) =>
        `INSERT INTO projects (slug, name, status, tags) VALUES (${sql(p.slug)}, ${sql(p.name)}, ${sql(p.status)}, ${sql(JSON.stringify(p.tags))})
ON CONFLICT (slug) DO UPDATE SET name = excluded.name, status = excluded.status, tags = excluded.tags;`,
    );
    d1ExecFile([...upserts, ...statements]);
    // 指標檔讓 repo 知道 git 外的大檔已在 R2；commit 由使用者或 Claude 決定
    for (const { file, pointer } of pointers) writeFileSync(file + POINTER_EXT, JSON.stringify(pointer, null, 2) + "\n");
  }

  console.log(`✔ ${dryRun ? "預計上傳" : "已上傳"} ${uploaded} 個，略過已歸檔 ${skipped} 個${pointers.length ? `，產生 ${pointers.length} 個 .r2.json 指標檔（請 commit）` : ""}`);
}

// git 管不到的檔案（被 ignore 的影片、或忘了 ignore 的大檔）是 Actions 歸檔不到的，要在 session 內處理
function findPending() {
  const pending = [];
  for (const { project, file, path, size } of scanOutputs()) {
    if (isGitIgnored(file)) {
      const pointer = readPointer(file);
      if (!pointer || pointer.size !== size) pending.push({ label: `${project.slug}/${path}`, reason: "未歸檔（不進 git，Actions 處理不到）" });
    } else if (size > GIT_SIZE_LIMIT) {
      pending.push({ label: `${project.slug}/${path}`, reason: `超過 20MB 卻會進 git，請把副檔名加進 .gitignore` });
    }
  }
  return pending;
}

async function cmdCheck(flags) {
  const hook = flags.includes("--hook");
  if (hook) {
    // Stop hook 擋過一次就放行，避免歸檔失敗時無限循環
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {}
    if (input.stop_hook_active) process.exit(0);
  }
  const pending = findPending();
  if (pending.length === 0) {
    if (!hook) console.log("✔ 沒有待歸檔的大檔");
    return;
  }
  const msg = `有 ${pending.length} 個成品需要在 session 內處理：\n${pending.map((p) => `  - ${p.label}：${p.reason}`).join("\n")}\n執行 \`npm run jt -- archive\` 歸檔，再 commit 產生的 .r2.json 指標檔。`;
  if (hook) {
    // exit 2：把訊息交給 Claude，讓它在結束前先處理
    console.error(msg);
    process.exit(2);
  }
  console.log(msg);
}

const [cmd, ...args] = process.argv.slice(2);
const commands = { new: cmdNew, archive: cmdArchive, check: cmdCheck };
if (!commands[cmd]) die("用法：jt <new|archive|check>");
try {
  await commands[cmd](args);
} catch (e) {
  die(e.stderr?.toString().trim() || e.message);
}
