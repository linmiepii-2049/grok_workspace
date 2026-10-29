#!/usr/bin/env node
// 旁白重新產生後，把 composition 的時間跟著新旁白移動，不用手改每個數字。
// 需要 vo-timeline.mjs 先產生新的 timeline.json（舊的會自動存成 timeline.prev.json）。做三件事：
//   1. 取代 <!-- vo:begin --> 和 <!-- vo:end --> 之間的旁白音軌與字幕
//   2. 取代 `const VO = {...};` 這一行（各句開始時間與總長），動畫時間寫成 VO["s3-01"] + 0.2 就會自動跟著動
//   3. 其他元素的 data-start、data-duration：起點和終點各自找最近的旁白錨點，保持與錨點的距離
// 用法：node scripts/retime.mjs <voiceover.json> <aspect 專案資料夾>... [--hold 1.04]
//   --hold：最後一句結束後保留的秒數，片尾字卡至少要停 2 秒
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const hold = args.includes("--hold") ? Number(args[args.indexOf("--hold") + 1]) : 1.04;
const paths = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--hold");
const [configPath, ...dirs] = paths;
if (!configPath || !dirs.length) {
  console.error("用法：node scripts/retime.mjs <voiceover.json> <aspect 專案資料夾>... [--hold 1.04]");
  process.exit(2);
}
const base = dirname(configPath);
const now = JSON.parse(readFileSync(join(base, "timeline.json"), "utf8"));
const prevPath = join(base, "timeline.prev.json");
const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;

const anchorsOf = (tl, total) => {
  const a = Object.fromEntries(tl.lines.map((l) => [l.id, l.start]));
  const last = tl.lines.at(-1);
  a.end = +(last.start + last.duration + hold).toFixed(3);
  if (total) a.end = total;
  return a;
};
const newA = anchorsOf(now);
const f = (n) => String(+n.toFixed(3));

for (const dir of dirs) {
  const file = join(dir, "index.html");
  let html = readFileSync(file, "utf8");
  const oldVO = html.match(/const VO = (\{.*?\});/s);
  // 舊錨點優先讀 composition 裡的 VO，沒有才用 timeline.prev.json
  const oldA = oldVO ? JSON.parse(oldVO[1]) : prev ? anchorsOf(prev) : null;
  if (!oldA) {
    console.error(`${file}：找不到 const VO 也沒有 timeline.prev.json，無法判斷舊時間`);
    process.exit(1);
  }
  const keys = Object.keys(newA).filter((k) => k in oldA);
  const remap = (t) => {
    if (Math.abs(t - oldA.end) < 1e-3) return newA.end;
    let best = keys[0];
    for (const k of keys) if (Math.abs(t - oldA[k]) < Math.abs(t - oldA[best])) best = k;
    return Math.max(0, t - oldA[best] + newA[best]);
  };

  // 素材路徑不能跨出專案資料夾，所以把旁白音檔複製到每個比例的專案裡
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const srcDir = resolve(base, config.output_dir);
  const dstDir = resolve(dir, config.output_dir.replace(/^[^/]+\//, ""));
  if (srcDir !== dstDir) cpSync(srcDir, dstDir, { recursive: true });

  // 1. 旁白與字幕：直接換成 vo-timeline.mjs 產生的片段
  const snippet = readFileSync(join(base, "timeline.snippet.html"), "utf8").replace(/^<!--.*?-->\n/, "");
  if (!/<!-- vo:begin -->[\s\S]*<!-- vo:end -->/.test(html)) {
    console.error(`${file}：找不到 <!-- vo:begin --> / <!-- vo:end --> 標記`);
    process.exit(1);
  }
  html = html.replace(/<!-- vo:begin -->[\s\S]*<!-- vo:end -->/, `<!-- vo:begin -->\n${snippet.trim()}\n<!-- vo:end -->`);

  // 3. 其他時間屬性（vo 區塊外）：起點與終點分別對到最近的錨點
  const [head, rest] = html.split("<!-- vo:begin -->");
  const [block, tail] = rest.split("<!-- vo:end -->");
  const shift = (part) =>
    part.replace(/data-start="([\d.]+)"(\s+)data-duration="([\d.]+)"/g, (_, s, ws, d) => {
      const start = remap(Number(s));
      const end = remap(Number(s) + Number(d));
      return `data-start="${f(start)}"${ws}data-duration="${f(Math.max(0.1, end - start))}"`;
    });
  html = shift(head) + "<!-- vo:begin -->" + block + "<!-- vo:end -->" + shift(tail);

  // 2. VO 錨點
  html = oldVO ? html.replace(/const VO = \{.*?\};/s, `const VO = ${JSON.stringify(newA)};`) : html;
  writeFileSync(file, html);
  console.log(`✓ ${file}：總長 ${f(oldA.end)}s → ${f(newA.end)}s`);
}
