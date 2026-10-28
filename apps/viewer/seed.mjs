#!/usr/bin/env node
// 把線上 D1 與 R2 複製到 wrangler 本機儲存，給 `npm run viewer:dev` 用
// 帳號無法建立遠端預覽 session，所以本機開發改用本機資料
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const CONFIG = join(ROOT, "apps/viewer/wrangler.jsonc");
const LOCAL_STATE = join(ROOT, ".wrangler/state/v3");
const wrangler = (...args) =>
  execFileSync(join(ROOT, "node_modules/.bin/wrangler"), [...args, "-c", CONFIG], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const tmp = mkdtempSync(join(tmpdir(), "jt-seed-"));

console.log("清空本機 D1 / R2");
rmSync(join(LOCAL_STATE, "d1"), { recursive: true, force: true });
rmSync(join(LOCAL_STATE, "r2"), { recursive: true, force: true });

console.log("匯出線上 D1 → 匯入本機");
const dump = join(tmp, "jteam.sql");
wrangler("d1", "export", "jteam", "--remote", "--output", dump);
wrangler("d1", "execute", "jteam", "--local", "--yes", "--file", dump);

const rows = JSON.parse(wrangler("d1", "execute", "jteam", "--local", "--json", "--command", "SELECT r2_key, content_type FROM artifacts WHERE r2_key IS NOT NULL"))[0].results;
console.log(`複製 ${rows.length} 個 R2 物件`);
for (const { r2_key, content_type } of rows) {
  const file = join(tmp, "obj");
  wrangler("r2", "object", "get", `jteam/${r2_key}`, "--remote", "--file", file);
  wrangler("r2", "object", "put", `jteam/${r2_key}`, "--local", "--file", file, "--content-type", content_type);
}

rmSync(tmp, { recursive: true, force: true });
console.log("✔ 完成");
