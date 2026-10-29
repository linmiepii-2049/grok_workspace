#!/usr/bin/env node
// 讀 tts.mjs 產生的時間碼，排出旁白時間軸與字幕分段，輸出 timeline.json 和可直接貼進 HyperFrames 的 HTML 片段。
// 規則見 references/audio.md 與 references/zh-typography.md。
// 用法：node scripts/vo-timeline.mjs <voiceover.json> [--max 14] [--gap 0.25] [--lead 0.3] [--tail 0.6]
//   --max：每行字幕字數上限（9:16 用 14、16:9 用 22）
//   --gap：句與句之間的停頓秒數；--lead：片頭第一句前的空白；--tail：最後一句後保留的秒數
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const configPath = args.find((a) => !a.startsWith("--") && !/^[\d.]+$/.test(a));
const opt = (name, def) => (args.includes(`--${name}`) ? Number(args[args.indexOf(`--${name}`) + 1]) : def);
const maxChars = opt("max", 14);
const gap = opt("gap", 0.25);
const lead = opt("lead", 0.3);
const tail = opt("tail", 0.6);
if (!configPath || !existsSync(configPath)) {
  console.error("用法：node scripts/vo-timeline.mjs <voiceover.json> [--max 14] [--gap 0.25] [--lead 0.3] [--tail 0.6]");
  process.exit(2);
}

const baseDir = dirname(configPath);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const voDir = resolve(baseDir, config.output_dir);
// HyperFrames 的素材路徑從 aspect 專案根目錄算起，例如 9x16/assets/audio/vo → assets/audio/vo
const assetPath = config.output_dir.replace(/^[^/]+\//, "");

// 句尾的逗號、句號、分號不放進字幕；問號、驚嘆號有語氣，保留
const BREAK = /[，。；、,;：:？！?!]/;
const DROP = /[，。；、,;：:]/;

const segmentsOf = (text) => {
  const segs = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (BREAK.test(text[i]) || i === text.length - 1) {
      segs.push([start, i + 1]);
      start = i + 1;
    }
  }
  // 太長的段落再切；在空白處優先切，避免切在詞中間。只剩一個標點時不另切，讓它跟著前一段
  const split = segs.flatMap(([s, e]) => {
    const out = [];
    while (e - s > maxChars && !(e - s === maxChars + 1 && BREAK.test(text[e - 1]))) {
      let cut = s + maxChars;
      for (let k = s + maxChars; k > s + maxChars / 2; k--) if (text[k] === " ") { cut = k; break; }
      out.push([s, cut]);
      s = cut;
    }
    out.push([s, e]);
    return out;
  });
  // 相鄰的短段落合併成一組，字幕才不會每半秒閃一次；合併處的標點換成全形空白
  const merged = [];
  for (const [s, e] of split) {
    const last = merged.at(-1);
    if (last && clean(text.slice(last[0], e)).length <= maxChars && !/[？！?!]$/.test(text.slice(last[0], last[1]).trim())) last[1] = e;
    else merged.push([s, e]);
  }
  return merged;
};

const clean = (t) =>
  t
    .trim()
    .replace(new RegExp(`${DROP.source}$`), "")
    .replace(new RegExp(DROP.source, "g"), "　")
    .trim();

let cursor = lead;
const lines = [];
const missing = [];
for (const line of config.lines) {
  const timingFile = join(voDir, `${line.id}.timing.json`);
  if (!existsSync(timingFile)) {
    missing.push(line.id);
    continue;
  }
  const timing = JSON.parse(readFileSync(timingFile, "utf8"));
  const chars = timing.chars;
  // 時間碼字元數和原文不同時（API 正規化過文字），改用比例估算，避免錯位
  const aligned = chars.length === line.text.length;
  const at = (i, edge) => {
    if (aligned) return chars[Math.min(i, chars.length - 1)][edge];
    return (i / line.text.length) * timing.duration;
  };
  const start = cursor;
  const captions = segmentsOf(line.text)
    .map(([s, e]) => {
      const text = clean(line.text.slice(s, e));
      if (!text) return null;
      return { text, start: +(start + at(s, "start")).toFixed(3), end: +(start + at(e - 1, "end")).toFixed(3) };
    })
    .filter(Boolean);
  // 每組字幕停到下一組出現為止，不留空檔
  captions.forEach((c, k) => {
    if (captions[k + 1]) c.end = captions[k + 1].start;
    else c.end = +(start + timing.duration).toFixed(3);
  });
  lines.push({ id: line.id, text: line.text, file: `${assetPath}/${line.id}.mp3`, start: +start.toFixed(3), duration: timing.duration, captions });
  cursor = start + timing.duration + gap;
}
if (missing.length) {
  console.error(`缺少時間碼：${missing.join("、")}，先執行 scripts/tts.mjs`);
  process.exit(1);
}

const total = +(cursor - gap + tail).toFixed(3);
// 舊的時間軸留給 retime.mjs 對照
const timelinePath = join(baseDir, "timeline.json");
const next = JSON.stringify({ total, maxChars, lines }, null, 2);
if (existsSync(timelinePath) && readFileSync(timelinePath, "utf8") !== next) {
  writeFileSync(join(baseDir, "timeline.prev.json"), readFileSync(timelinePath, "utf8"));
}
writeFileSync(timelinePath, next);

const f = (n) => n.toFixed(3);
const html = [
  `<!-- vo-timeline.mjs 產生；總長 ${f(total)}s。音軌放在根 composition，字幕放在 data-track-kind="captions" 的容器裡 -->`,
  ...lines.map((l) => `<audio id="vo-${l.id}" class="clip" src="${l.file}" data-start="${f(l.start)}" data-duration="${f(l.duration)}"></audio>`),
  `<div id="captions" data-track-kind="captions">`,
  ...lines.flatMap((l) =>
    l.captions.map(
      (c, k) => `  <div id="cap-${l.id}-${k + 1}" class="clip caption" data-start="${f(c.start)}" data-duration="${f(c.end - c.start)}"><span>${c.text}</span></div>`,
    ),
  ),
  `</div>`,
].join("\n");
writeFileSync(join(baseDir, "timeline.snippet.html"), html + "\n");

console.log(`總長 ${f(total)}s，${lines.length} 句，${lines.reduce((s, l) => s + l.captions.length, 0)} 組字幕（每行 ≤${maxChars} 字）`);
for (const l of lines) console.log(`  ${l.id}  ${f(l.start)}–${f(l.start + l.duration)}  ${l.captions.map((c) => c.text).join(" / ")}`);
console.log(`輸出：${join(baseDir, "timeline.json")}、${join(baseDir, "timeline.snippet.html")}`);
