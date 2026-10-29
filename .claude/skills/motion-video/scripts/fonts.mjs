#!/usr/bin/env node
// 只下載影片用到的字：收集專案 HTML 裡出現的所有字元，用 Google Fonts 的 text= 參數取得子集 woff2。
// 中文字型完整檔動輒數 MB，子集通常只有十幾 KB，渲染時也不依賴網路。
// 用法：node scripts/fonts.mjs <aspect 專案資料夾> "Noto Sans TC:700" "Noto Serif TC:700" ...
// 改了文案就重跑一次，新出現的字才會有字形。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, ...families] = process.argv.slice(2);
if (!dir || !families.length || !existsSync(dir)) {
  console.error('用法：node scripts/fonts.mjs <aspect 專案資料夾> "Noto Sans TC:700" ...');
  process.exit(2);
}

const htmlFiles = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    if (f.startsWith(".") || f === "node_modules" || f === "assets") return [];
    return statSync(p).isDirectory() ? htmlFiles(p) : p.endsWith(".html") ? [p] : [];
  });
// 收集全部字元（含程式碼裡的 ASCII），多抓一點沒關係，ASCII 只多幾 KB
const chars = new Set();
for (const f of htmlFiles(dir)) for (const c of readFileSync(f, "utf8")) if (c.trim()) chars.add(c);
const text = [...chars].join("");

// 要帶新版瀏覽器的 User-Agent，Google Fonts 才會回傳 woff2
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const outDir = join(dir, "assets/fonts");
mkdirSync(outDir, { recursive: true });
const faces = [];
for (const spec of families) {
  const [family, weight = "400"] = spec.split(":");
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await fetch(url, { headers: { "user-agent": UA } }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${spec}：HTTP ${r.status}`))));
  const src = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!src) throw new Error(`${spec}：Google Fonts 沒有回傳字型檔，確認字型名稱與字重`);
  const file = `${family.replace(/\s+/g, "")}-${weight}.woff2`;
  const buf = Buffer.from(await fetch(src, { headers: { "user-agent": UA } }).then((r) => r.arrayBuffer()));
  writeFileSync(join(outDir, file), buf);
  console.log(`  ✓ ${file}（${(buf.length / 1024).toFixed(1)} KB）`);
  faces.push(`@font-face { font-family: "${family}"; src: url("assets/fonts/${file}") format("woff2"); font-weight: ${weight}; }`);
}
console.log(`${chars.size} 個字元。貼進 <style>：\n${faces.join("\n")}`);
