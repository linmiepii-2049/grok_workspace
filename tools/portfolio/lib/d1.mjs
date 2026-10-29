// 把結果寫成 SQL 檔，交給 wrangler d1 execute 一次執行
// --local 寫進 jteam-viewer 的本機 D1（npm run viewer:dev 用）；否則寫線上 D1，需要 CLOUDFLARE_API_TOKEN 或 wrangler login
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");

export const sql = (v) => {
  if (v == null) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`不能寫入非有限數字：${v}`);
    return String(v);
  }
  if (typeof v === "object") v = JSON.stringify(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

export const insert = (table, row, { conflict = "" } = {}) => {
  const cols = Object.keys(row);
  return `INSERT ${conflict} INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => sql(row[c])).join(", ")});`;
};

export function execute(statements, { local = false, dryRun = false } = {}) {
  if (!statements.length) return;
  if (dryRun) {
    console.log(statements.join("\n"));
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "jt-portfolio-"));
  const file = join(dir, "write.sql");
  writeFileSync(file, statements.join("\n") + "\n");
  const bin = existsSync(join(ROOT, "node_modules/.bin/wrangler")) ? join(ROOT, "node_modules/.bin/wrangler") : "wrangler";
  const config = join(ROOT, local ? "apps/viewer/wrangler.jsonc" : "infra/wrangler.jsonc");
  try {
    execFileSync(bin, ["d1", "execute", "jteam", local ? "--local" : "--remote", "--yes", "--file", file, "-c", config], {
      cwd: ROOT, stdio: ["ignore", "ignore", "inherit"],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
