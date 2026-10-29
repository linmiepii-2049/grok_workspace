// 前後對比：短 Prompt 和長 Prompt，下面兩個大數字
// props: before, after, stats: [{ pre, num, post, at }], line
import { esc, mv, ink } from "../lib.mjs";

export default ({ props, ctx }) => {
  const l = props.line;
  const html = `
  <div id="p-before-l" class="abs" style="left:96px;top:270px;font:500 30px/1 var(--zh);color:var(--muted);letter-spacing:.1em">之前</div>
  <div id="p-before" class="k-card" style="top:316px;padding:26px 40px">
    <div style="font:400 40px/1.4 var(--zh);color:var(--muted)">${esc(props.before)}</div>
  </div>
  ${ink("p-cross", { left: 112, top: 348, w: 370, h: 20 }, "M0 50 L100 50")}
  <div id="p-after-l" class="abs" style="left:96px;top:476px;font:500 30px/1 var(--zh);color:var(--teal-ink);letter-spacing:.1em">之後</div>
  <div id="p-after" class="k-card" style="top:522px;padding:26px 40px">
    <div style="font:400 40px/1.5 var(--zh)">${esc(props.after)}</div>
  </div>
  ${props.stats
    .map(
      (s, i) => `<div id="p-stat${i}" class="abs" style="left:0;right:0;top:${840 + i * 160}px;text-align:center;font:300 64px/1 var(--zh);display:flex;align-items:baseline;justify-content:center;gap:20px">
    <span>${esc(s.pre)}</span><span id="p-num${i}" class="k-num" style="font-size:150px">0</span><span>${esc(s.post)}</span></div>`,
    )
    .join("")}`;
  const js = [
    mv.wipeUp("#p-before-l", 0, 0.3),
    mv.grow("#p-before", 0, 0.4),
    mv.draw("#p-cross path", 0.5, 0.3),
    mv.wipeUp("#p-after-l", 0.25, 0.3),
    mv.grow("#p-after", 0.25, 0.5),
    ...props.stats.flatMap((s, i) => [mv.wipeUp(`#p-stat${i}`, ctx.at(l, s.at) - 0.25, 0.35), mv.count(`#p-num${i}`, 0, s.num, ctx.at(l, s.at) - 0.1, 0.5)]),
  ];
  props.stats.forEach((s) => ctx.sfx("impact-bass-1", ctx.at(l, s.at) + 0.35, 0.3));
  return { html, js };
};
