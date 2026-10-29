// 元件共用工具：文字轉 HTML、產生 GSAP 動態程式碼。場景元件只組合這些，不直接寫 GSAP 細節
import { readFileSync } from "node:fs";
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// **重點** → <em>重點</em>
export const em = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<em>$1</em>");

// 逐字拆成 span.ch，給打字動態用；**重點** 照樣轉成 em
export const chars = (s) =>
  String(s)
    .split(/(\*\*.+?\*\*)/)
    .map((part) => {
      const hot = /^\*\*.+\*\*$/.test(part);
      const body = [...(hot ? part.slice(2, -2) : part)].map((c) => (c === "\n" ? "<br>" : `<span class="ch">${esc(c)}</span>`)).join("");
      return hot ? `<em>${body}</em>` : body;
    })
    .join("");

const n = (x) => Number(x.toFixed(3));

// 動態詞彙。每個函式回傳一行 GSAP 程式碼，t 是場景內的秒數
export const mv = {
  // 逐字打出，在 dur 秒內打完
  type: (sel, t, dur) => {
    return `{ const cs = document.querySelectorAll("${sel} .ch"); tl.fromTo(cs, { opacity: 0 }, { opacity: 1, duration: 0.01, ease: "none", stagger: ${n(dur)} / Math.max(cs.length, 1) }, ${n(t)}); }`;
  },
  // 由下往上揭開（遮罩），不是淡入
  wipeUp: (sel, t, d = 0.5) =>
    `tl.fromTo("${sel}", { clipPath: "inset(100% 0% 0% 0%)", y: 28 }, { clipPath: "inset(0% 0% 0% 0%)", y: 0, duration: ${d}, ease: "power3.out" }, ${n(t)});`,
  // 由左往右揭開
  wipeRight: (sel, t, d = 0.45) =>
    `tl.fromTo("${sel}", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: ${d}, ease: "power2.inOut" }, ${n(t)});`,
  // 由上往下展開（卡片從上緣長出來）
  grow: (sel, t, d = 0.45) =>
    `tl.fromTo("${sel}", { clipPath: "inset(0% 0% 100% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: ${d}, ease: "power3.out" }, ${n(t)});`,
  // 手繪線條畫出來
  draw: (sel, t, d = 0.4) => `tl.fromTo("${sel}", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: ${d}, ease: "power2.inOut" }, ${n(t)});`,
  // 蓋章
  stamp: (sel, t, rot = -8) =>
    `tl.fromTo("${sel}", { opacity: 0, scale: 1.7, rotation: ${rot - 8} }, { opacity: 1, scale: 1, rotation: ${rot}, duration: 0.26, ease: "back.out(2)" }, ${n(t)});`,
  // 彈出
  pop: (sel, t, d = 0.35) => `tl.fromTo("${sel}", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: ${d}, ease: "back.out(2.2)" }, ${n(t)});`,
  // 從某處飛進定位
  fly: (sel, t, dx, dy, d = 0.5) =>
    `tl.fromTo("${sel}", { x: ${dx}, y: ${dy} }, { x: 0, y: 0, duration: ${d}, ease: "power3.inOut" }, ${n(t)});`,
  // 退到背景
  dim: (sel, t, to = 0.35, d = 0.3) => `tl.to("${sel}", { opacity: ${to}, duration: ${d}, ease: "power1.out" }, ${n(t)});`,
  out: (sel, t, d = 0.25) => `tl.to("${sel}", { opacity: 0, duration: ${d}, ease: "power2.in" }, ${n(t)});`,
  show: (sel, t) => `tl.fromTo("${sel}", { opacity: 0 }, { opacity: 1, duration: 0.01 }, ${n(t)});`,
  // 人物待機：上下輕晃，dur 秒內來回（時間都在時間軸上，逐格渲染結果固定）
  bob: (sel, t, dur, amp = 10, period = 1.6) =>
    `tl.to("${sel}", { y: -${amp}, rotation: 1.2, duration: ${period / 2}, ease: "sine.inOut", yoyo: true, repeat: ${Math.max(1, Math.floor(dur / (period / 2)) - 1)} }, ${n(t)});`,
  // 數字跳動
  count: (sel, from, to, t, d = 0.6) =>
    `{ const el = document.querySelector("${sel}"); const o = { v: ${from} }; tl.fromTo(o, { v: ${from} }, { v: ${to}, duration: ${d}, ease: "power2.out", onUpdate: () => { el.textContent = Math.round(o.v); } }, ${n(t)}); }`,
  // 標籤從空槽變實心：.fill 彈出蓋住虛線框
  fillTag: (sel, t) =>
    `tl.fromTo("${sel} .fill", { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2.4)" }, ${n(t)}); tl.fromTo("${sel} .lbl", { opacity: 1 }, { opacity: 0, duration: 0.01 }, ${n(t + 0.15)});`,
};

// 手繪線 SVG：box 是像素位置 { left, top, w, h }，d 用 0～100 的相對座標（只用 M/L/C 指令），換算成像素，線寬才不會被拉變形
export const ink = (id, box, d, style = "") => {
  let k = 0;
  const px = d.replace(/-?[\d.]+/g, (v) => (Number(v) * (k++ % 2 ? box.h : box.w)) / 100);
  return `<svg id="${id}" class="k-ink" style="left:${box.left}px;top:${box.top}px;width:${box.w}px;height:${box.h}px;${style}" viewBox="0 0 ${box.w} ${box.h}"><path pathLength="1" d="${px}"/></svg>`;
};

// 標籤：虛線空槽，填滿時 .fill 彈出
export const tag = (id, label, style = "") =>
  `<span id="${id}" class="k-tag" style="${style}"><span class="lbl">${esc(label)}</span><span class="fill">${esc(label)}</span></span>`;

// Open Peeps 人物（kit/peeps/<name>.svg，由 peeps/gen.cjs 產生）：inline SVG，box 是像素位置 { left, top, h }，寬度照比例
export const peep = (id, name, box, flip = false) => {
  const svg = readFileSync(new URL(`./peeps/${name}.svg`, import.meta.url), "utf8").trim();
  const w = Math.round((box.h * 850) / 1200);
  return `<div id="${id}" class="abs" data-layout-ignore style="left:${box.left}px;top:${box.top}px;width:${w}px;height:${box.h}px;transform-origin:50% 100%">
    <div style="width:100%;height:100%;${flip ? "transform:scaleX(-1)" : ""}">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></div>`;
};
