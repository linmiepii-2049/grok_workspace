#!/usr/bin/env node
// 把 DRAFT.md 排成 PDF（beige-teal 配色，A5 直式，一招一頁，手機好讀、好截圖）
// 用法：node prompt-pack/build-pdf.mjs
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, "..");
const OUT = join(PROJECT, "outputs/prompt-pack/上班族-AI-指令包-30招.pdf");
const theme = JSON.parse(readFileSync(join(PROJECT, "carousel/themes/beige-teal/theme.json"), "utf8"));
const profile = JSON.parse(readFileSync(join(PROJECT, "carousel/profile.json"), "utf8"));
const md = readFileSync(join(HERE, "DRAFT.md"), "utf8");

// ---- 解析 DRAFT.md ----
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const holes = (s) => esc(s).replace(/【(.+?)】/g, '<span class="hole">【$1】</span>');

const section = (title) => md.split(/^## /m).find((s) => s.startsWith(title)) ?? "";
const howto = [...section("怎麼用").matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
const back = section("封底").split("\n").slice(1).map((l) => l.trim()).filter(Boolean);

const cats = md
  .split(/^## /m)
  .filter((s) => /^[一二三四五六]、/.test(s))
  .map((s) => {
    const [head, ...rest] = s.split(/^### /m);
    const name = head.split("\n")[0].replace(/^[一二三四五六]、/, "").trim();
    const tips = rest.map((t) => {
      const [, no, title, sub] = t.match(/^(\d+) (.+?)｜(.+)$/m);
      return {
        no,
        title,
        sub,
        when: t.match(/^情境：(.+)$/m)[1],
        prompt: t.match(/```\n([\s\S]+?)\n```/)[1],
        taste: t.match(/^品味提醒：(.+)$/m)[1],
      };
    });
    return { name, tips };
  });
const total = cats.reduce((n, c) => n + c.tips.length, 0);
if (total !== 30) throw new Error(`解析到 ${total} 招，不是 30 招`);

// ---- 版面 ----
const c = theme.colors;
const foot = (right) => `<div class="foot"><span class="latin">${esc(profile.handle)}</span><span>${right}</span></div>`;

const pages = [];
pages.push(`<section class="page cover">
  <div class="stripe"></div>
  <div class="kicker">TRISTAN ／ AI HACKS</div>
  <h1 class="stretch">上班族<br>AI 指令包<br><em>30</em> 招</h1>
  <p class="lead">複製、貼上、換掉【】裡的字，就能用</p>
  <div class="me"><img src="${pathToFileURL(join(PROJECT, "carousel", profile.avatar)).href}" alt=""><div><b class="latin">${esc(profile.author.toUpperCase())}</b><span class="latin">${esc(profile.handle)}</span></div></div>
</section>`);

pages.push(`<section class="page">
  <div class="kicker">HOW TO USE</div>
  <h2 class="stretch">怎麼用</h2>
  <ol class="howto">${howto.map((h) => `<li>${inline(h)}</li>`).join("")}</ol>
  <div class="toc">${cats.map((cat, i) => `<div><span class="latin">${String(i + 1).padStart(2, "0")}</span>${esc(cat.name)}<span class="range latin">${cat.tips[0].no}–${cat.tips.at(-1).no}</span></div>`).join("")}</div>
  ${foot("上班族 AI 指令包 30 招")}
</section>`);

cats.forEach((cat, ci) => {
  pages.push(`<section class="page divider">
    <div class="big latin">${String(ci + 1).padStart(2, "0")}</div>
    <h2 class="stretch">${esc(cat.name)}</h2>
    <ul>${cat.tips.map((t) => `<li><span class="latin">${t.no}</span>${esc(t.title)}</li>`).join("")}</ul>
    <div class="stripe"></div>
  </section>`);
  for (const t of cat.tips) {
    pages.push(`<section class="page tip">
      <div class="kicker">${esc(cat.name)}</div>
      <div class="num latin">${t.no}</div>
      <h2 class="stretch">${esc(t.title)}</h2>
      <p class="sub">${esc(t.sub)}</p>
      <p class="when"><span>情境</span>${esc(t.when)}</p>
      <div class="card"><div class="label">複製這段</div><pre>${holes(t.prompt)}</pre></div>
      <div class="taste"><div class="label">品味提醒</div><p>${inline(t.taste)}</p></div>
      ${foot(`${t.no} / ${total}`)}
    </section>`);
  }
});

pages.push(`<section class="page cover end">
  <div class="stripe"></div>
  <h2 class="stretch">${inline(back[0]).replace(/<\/?b>/g, "")}</h2>
  ${back.slice(1).map((l) => `<p class="lead">${inline(l)}</p>`).join("")}
</section>`);

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<link rel="stylesheet" href="${theme.fonts.css}">
<style>
  @page { size: 148mm 210mm; margin: 0; }
  :root { --bg:${c.bg}; --ink:${c.ink}; --muted:#6F6963; --teal:${c.teal}; --teal-ink:#4E7774; --coral:${c.coral}; --apricot:${c.apricot}; --card:${c.card}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${theme.fonts.body}, sans-serif; font-weight: 300; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .latin { font-family: ${theme.fonts.latin}, sans-serif; }
  .page { width: 148mm; height: 210mm; padding: 16mm 14mm 14mm; background: var(--bg); position: relative; overflow: hidden; page-break-after: always; }
  .stretch { font-weight: 200; display: inline-block; transform: scaleY(${theme.fonts.titleStretch}); transform-origin: left top; letter-spacing: .02em; }
  em { font-style: normal; color: var(--coral); font-weight: 300; }
  b { font-weight: 500; }
  .kicker { font-size: 9pt; font-weight: 500; letter-spacing: .14em; color: var(--teal-ink); }
  .foot { position: absolute; left: 14mm; right: 14mm; bottom: 9mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: var(--muted); letter-spacing: .06em; border-top: .3mm solid rgba(58,56,54,.15); padding-top: 2.5mm; }
  .stripe { position: absolute; left: 0; right: 0; bottom: 0; height: 9mm; background: repeating-linear-gradient(135deg, var(--apricot) 0 3mm, transparent 3mm 6mm); opacity: .55; }

  .cover { display: flex; flex-direction: column; justify-content: center; }
  .cover h1 { font-size: 46pt; line-height: 1.12; margin: 6mm 0 14mm; }
  .cover .lead { font-size: 12.5pt; color: var(--muted); line-height: 1.8; }
  .cover .me { display: flex; align-items: center; gap: 4mm; margin-top: 22mm; }
  .cover .me img { width: 18mm; height: 18mm; border-radius: 50%; object-fit: cover; background: var(--teal); }
  .cover .me b { display: block; font-size: 11pt; font-weight: 800; letter-spacing: .24em; }
  .cover .me span { font-size: 9pt; color: var(--muted); }
  .end h2 { font-size: 28pt; line-height: 1.4; margin-bottom: 14mm; }
  .end .lead { margin-bottom: 4mm; }
  .end .lead b { color: var(--ink); }

  h2 { font-size: 26pt; line-height: 1.25; margin: 3mm 0 6mm; }
  .howto { list-style: none; counter-reset: n; margin-top: 4mm; }
  .howto li { counter-increment: n; position: relative; padding-left: 9mm; margin-bottom: 4mm; font-size: 12pt; line-height: 1.7; }
  .howto li::before { content: counter(n); position: absolute; left: 0; top: -.5mm; font: 500 13pt/1.4 ${theme.fonts.latin}; color: var(--apricot); }
  .toc { margin-top: 8mm; border-top: .3mm solid rgba(58,56,54,.15); }
  .toc div { display: flex; align-items: baseline; gap: 4mm; padding: 2.4mm 0; border-bottom: .3mm solid rgba(58,56,54,.1); font-size: 10.5pt; font-weight: 400; }
  .toc .latin { color: var(--teal-ink); font-weight: 700; font-size: 9pt; }
  .toc .range { margin-left: auto; color: var(--muted); font-weight: 500; }

  .divider { background: var(--teal); color: var(--bg); display: flex; flex-direction: column; justify-content: center; }
  .divider .big { font-size: 64pt; font-weight: 800; color: var(--apricot); line-height: 1; }
  .divider h2 { font-size: 34pt; margin: 6mm 0 12mm; }
  .divider ul { list-style: none; }
  .divider li { font-size: 12pt; font-weight: 400; padding: 2.6mm 0; border-bottom: .3mm solid rgba(245,239,231,.3); }
  .divider li span { display: inline-block; width: 11mm; font-weight: 700; font-size: 10pt; color: var(--apricot); }

  .tip .num { position: absolute; right: 14mm; top: 11mm; font-size: 40pt; font-weight: 800; color: var(--apricot); line-height: 1; }
  .tip h2 { font-size: 30pt; margin: 6mm 0 6mm; }
  .tip .sub { font-size: 13pt; color: var(--coral); font-weight: 400; margin-bottom: 5mm; }
  .tip .when { font-size: 12pt; color: var(--muted); line-height: 1.7; margin-bottom: 5mm; }
  .tip .when span { display: inline-block; font-size: 9pt; font-weight: 500; color: var(--bg); background: var(--teal-ink); padding: .6mm 2mm; border-radius: 1mm; margin-right: 2.5mm; vertical-align: .3mm; }
  .card { background: var(--card); border: .4mm solid rgba(58,56,54,.14); border-radius: 3mm; padding: 5mm 5mm 5.5mm; box-shadow: 0 2mm 6mm rgba(58,56,54,.08); }
  .label { font-size: 9pt; font-weight: 500; letter-spacing: .12em; color: var(--teal-ink); margin-bottom: 2.5mm; }
  pre { font-family: ${theme.fonts.body}, sans-serif; font-weight: 400; font-size: 12.5pt; line-height: 1.7; white-space: pre-wrap; word-break: break-all; }
  .hole { color: var(--coral); }
  .taste { margin-top: 6mm; border-left: .8mm solid var(--coral); padding-left: 4mm; }
  .taste .label { color: var(--coral); }
  .taste p { font-size: 12pt; line-height: 1.75; font-weight: 400; }
</style></head><body>${pages.join("\n")}</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
const htmlPath = join(HERE, ".build.html");
writeFileSync(htmlPath, html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
// 每招一頁：內容超出頁面就報錯，不要默默被切掉
const over = await page.evaluate(() =>
  [...document.querySelectorAll(".page")].flatMap((p, i) => {
    const bottom = p.getBoundingClientRect().bottom - 18 * 3.78;
    const last = [...p.children].filter((e) => !e.matches(".foot,.stripe,.num")).at(-1);
    return last && last.getBoundingClientRect().bottom > bottom ? [i + 1] : [];
  }),
);
await page.pdf({ path: OUT, preferCSSPageSize: true, printBackground: true });
await browser.close();
unlinkSync(htmlPath);
console.log(`${OUT}（${pages.length} 頁）`);
if (over.length) console.warn(`⚠ 內容超出頁面：第 ${over.join("、")} 頁`);
