#!/usr/bin/env node
// 把一集的 episode.json 組成 HyperFrames 專案（<集>/9x16/）。元件在 scenes/，品牌樣式在 brand.css。
// 有旁白時間碼（tts.mjs + vo-timeline.mjs 產生）就照它排；還沒有就用字數估算，先看畫面節奏。
// 旁白改了：重跑 tts → vo-timeline → 這支腳本，所有動畫時間自動跟著旁白走，不用手改。
// 用法：node reels/kit/build.mjs reels/<集> [--fonts]
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { esc } from "./lib.mjs";

const KIT = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(KIT, "../../../..");
const [epArg, ...flags] = process.argv.slice(2);
if (!epArg || !existsSync(join(epArg, "episode.json"))) {
  console.error("用法：node reels/kit/build.mjs reels/<集> [--fonts]");
  process.exit(2);
}
const EP = resolve(epArg);
const OUT = join(EP, "9x16");
const W = 1080, H = 1920, TAIL = 2.0;
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const episode = read(join(EP, "episode.json"));
const vo = read(join(EP, "voiceover.json"));
const profile = read(join(KIT, "../../carousel/profile.json"));
const brandCss = readFileSync(join(KIT, "brand.css"), "utf8");

// ---- HyperFrames 專案 ----
// tts workflow 會先建好 9x16/assets/audio，init 不接受非空資料夾：先 init 到暫存資料夾再搬過來，不覆蓋旁白
if (!existsSync(join(OUT, "hyperframes.json"))) {
  const tmp = `${OUT}.init`;
  execFileSync("npx", ["hyperframes", "init", tmp, "--non-interactive", "--skip-skills", "--resolution", "portrait", "-e", "blank"], { cwd: REPO, stdio: "inherit" });
  cpSync(tmp, OUT, { recursive: true, force: false });
  rmSync(tmp, { recursive: true });
}
for (const d of ["compositions", "assets/sfx", "assets/img", "assets/fonts"]) mkdirSync(join(OUT, d), { recursive: true });

// ---- 旁白時間軸 ----
const timelinePath = join(EP, "timeline.json");
const voDir = resolve(EP, vo.output_dir);
const replace = (s) => Object.entries(episode.captionReplace ?? {}).reduce((t, [a, b]) => t.split(a).join(b), s);
let lines, estimated = false;
if (existsSync(timelinePath)) {
  lines = read(timelinePath).lines.map((l) => {
    const tf = join(voDir, `${l.id}.timing.json`);
    return { ...l, chars: existsSync(tf) ? read(tf).chars : null };
  });
} else {
  // 估算：每秒 5 字，句間 0.25 秒；字幕依標點分段
  estimated = true;
  let t = 0.3;
  lines = vo.lines.map((l) => {
    const duration = Number((l.text.length / 5 + 0.2).toFixed(3));
    const segs = l.text.split(/(?<=[，。；？！：])/).filter((s) => s.replace(/[，。；：]/g, "").trim());
    let c = t;
    const captions = segs.map((s) => {
      const d = (duration * s.length) / l.text.length;
      const cap = { text: s.replace(/[，。；：]$/g, ""), start: c, end: c + d };
      c += d;
      return cap;
    });
    const line = { id: l.id, text: l.text, start: t, duration, captions, chars: null };
    t += duration + 0.25;
    return line;
  });
}
const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
const total = Number((lines.at(-1).start + lines.at(-1).duration + TAIL).toFixed(3));

// 某句旁白裡某個詞開始念的時間（絕對秒數）
const wordAt = (id, sub) => {
  const l = byId[id];
  if (!l) throw new Error(`episode.json 用到不存在的旁白 id：${id}`);
  const idx = sub ? l.text.indexOf(sub) : 0;
  if (idx < 0) throw new Error(`「${sub}」不在旁白 ${id}：${l.text}`);
  if (l.chars?.length === [...l.text].length) return l.start + l.chars[idx].start;
  return l.start + (l.duration * idx) / l.text.length;
};

const fontFaces = [200, 300, 400, 500]
  .map((w) => `@font-face { font-family: "Noto Sans TC"; src: url("assets/fonts/NotoSansTC-${w}.woff2") format("woff2"); font-weight: ${w}; }`)
  .join("\n      ");

// ---- 場景 ----
const scenes = episode.scenes.map((s, i) => {
  const first = s.lines?.[0] ?? s.line ?? s.rows?.[0]?.line;
  return { ...s, id: s.id ?? `s${i + 1}-${s.type}`, first };
});
scenes.forEach((s, i) => {
  s.start = i === 0 ? 0 : Number((byId[s.first].start - (s.lead ?? 0.35)).toFixed(3));
});
scenes.forEach((s, i) => {
  s.dur = Number(((scenes[i + 1]?.start ?? total) - s.start).toFixed(3));
});

const sfxLib = join(REPO, "node_modules/hyperframes/dist/skills/media-use/audio/assets/sfx");
const sfxLen = Object.fromEntries(Object.entries(read(join(sfxLib, "manifest.json"))).map(([k, v]) => [k, v.duration]));
const sfx = [];
const usedSfx = new Set();
const r3 = (x) => Number(x.toFixed(3));
for (const s of scenes) {
  const mod = (await import(join(KIT, "scenes", `${s.type}.mjs`))).default;
  const ctx = {
    t: (id, frac = 0) => r3(byId[id].start + byId[id].duration * frac - s.start),
    end: (id) => r3(byId[id].start + byId[id].duration - s.start),
    at: (id, sub) => r3(wordAt(id, sub) - s.start),
    dur: s.dur,
    profile: { ...profile, photo: "assets/img/" + basename(profile.avatar) },
    sfx: (name, t, volume = 0.3, duration) => {
      usedSfx.add(name);
      sfx.push({ name, start: r3(s.start + Math.max(0, t)), volume, duration: duration && Math.min(duration, sfxLen[name] ?? duration) });
    },
  };
  const props = { ...s, lines: s.lines };
  const { html, js } = mod({ props, ctx });
  writeFileSync(
    join(OUT, "compositions", `${s.id}.html`),
    `<!-- build.mjs 產生，不要手改：改 episode.json 或 kit/scenes/${s.type}.mjs 後重跑 -->
<template>
  <style>
    ${fontFaces}
${brandCss}
  </style>
  <div id="root" data-composition-id="${s.id}" data-width="${W}" data-height="${H}">${html}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${js.join("\n    ")}
    tl.set({}, {}, ${s.dur});
    window.__timelines["${s.id}"] = tl;
  </script>
</template>
`,
  );
}

// ---- 素材 ----
for (const name of usedSfx) copyFileSync(join(sfxLib, `${name}.mp3`), join(OUT, "assets/sfx", `${name}.mp3`));
copyFileSync(join(KIT, "../../carousel", profile.avatar), join(OUT, "assets/img", basename(profile.avatar)));

// ---- 根 composition ----
const ser = episode.series;

const audio = estimated
  ? "<!-- 旁白還沒產生：時間軸是估算的 -->"
  : lines.map((l) => `<audio id="vo-${l.id}" class="clip" src="assets/audio/vo/${l.id}.mp3" data-start="${l.start}" data-duration="${l.duration}" data-volume="1"></audio>`).join("\n      ");
const sfxTags = sfx
  .map((c, i) => `<audio id="sfx-${i + 1}" class="clip" src="assets/sfx/${c.name}.mp3" data-start="${c.start}"${c.duration ? ` data-duration="${r3(c.duration)}"` : ""} data-volume="${c.volume}"></audio>`)
  .join("\n      ");
const captions = lines
  .flatMap((l) => l.captions.map((c, j) => ({ id: `cap-${l.id}-${j + 1}`, text: replace(c.text), start: r3(c.start), dur: r3(c.end - c.start) })))
  .map((c) => `<div id="${c.id}" class="clip caption" data-start="${c.start}" data-duration="${c.dur}"><span>${esc(c.text)}</span></div>`)
  .join("\n        ");

writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html>
<!-- build.mjs 產生，不要手改：改 ../episode.json 或 reels/kit/ 後重跑 node reels/kit/build.mjs ${basename(EP)} -->
<html lang="zh-Hant" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      ${fontFaces}
${brandCss}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: var(--bg); }
      #root { overflow: hidden; background: var(--bg); }
      #bg { position: absolute; inset: 0; }
      .deco { position: absolute; }
      #deco-stripes { left: -60px; bottom: 120px; width: 360px; height: 120px; color: var(--apricot); background: repeating-linear-gradient(135deg, currentColor 0 14px, transparent 14px 34px); opacity: 0.55; }
      #deco-dots { right: 60px; bottom: 90px; width: 264px; height: 176px; color: var(--teal); background-image: radial-gradient(circle, currentColor 6px, transparent 7px); background-size: 44px 44px; opacity: 0.35; }
      #badge { position: absolute; left: 80px; top: 176px; display: flex; align-items: center; gap: 18px; }
      #badge .em { width: 64px; height: 64px; border-radius: 50%; background: var(--teal-deep); color: #fff; display: flex; align-items: center; justify-content: center; font: 500 34px/1 var(--zh); }
      #badge .t { font: 800 28px/1 var(--latin); letter-spacing: 0.2em; color: var(--teal-ink); }
      #captions { position: absolute; left: 0; right: 0; top: 1180px; height: 140px; }
      .caption { position: absolute; left: 60px; right: 60px; top: 0; display: flex; justify-content: center; }
      .caption span { background: var(--ink); color: var(--card); font: 500 44px/1.35 var(--zh); letter-spacing: 0.03em; padding: 12px 28px; border-radius: 14px; text-align: center; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}">
      <div id="bg" data-layout-ignore>
        <div id="deco-stripes" class="deco"></div>
        <div id="deco-dots" class="deco"></div>
      </div>
      <div id="badge"><span class="em">${esc(ser.emblem)}</span><span class="t">${esc(ser.en)} #${esc(ser.no)}</span></div>
      ${scenes
        .map(
          (s, i) =>
            `<div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${s.start}" data-duration="${s.dur}" data-track-index="${i + 1}" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>`,
        )
        .join("\n      ")}
      ${audio}
      ${sfxTags}
      <div id="captions" data-track-kind="captions">
        ${captions}
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`,
);

if (flags.includes("--fonts") || !existsSync(join(OUT, "assets/fonts/NotoSansTC-200.woff2"))) {
  execFileSync("node", [join(REPO, ".claude/skills/motion-video/scripts/fonts.mjs"), OUT, ...[200, 300, 400, 500].map((w) => `Noto Sans TC:${w}`)], { stdio: "inherit" });
}
console.log(`完成：${scenes.length} 個場景，總長 ${total}s${estimated ? "（旁白未產生，時間是估算的）" : ""} → ${OUT}`);
