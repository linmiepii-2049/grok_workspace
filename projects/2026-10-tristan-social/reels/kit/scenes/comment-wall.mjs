// 互動鉤子：大標問題，下面留言一則一則彈進來，最後大標換成一張便利貼（承諾）
// props: title, comments: [{ name, text, line, at }]（兩欄排列，最多 6 則）, note, noteLine, noteAt
import { em, esc, mv } from "../lib.mjs";

export default ({ props, ctx }) => {
  const colX = [80, 560], rowY = [610, 770, 930];
  const html = `
  <div id="w-title" class="k-title" style="top:250px"><span class="s" style="font-size:108px">${em(props.title)}</span></div>
  ${props.comments
    .map(
      (c, i) => `<div id="w-c${i}" class="abs" style="left:${colX[i % 2]}px;top:${rowY[Math.floor(i / 2)] + (i % 2) * 24}px;width:440px;display:flex;gap:20px;align-items:flex-start;background:var(--card);border:1.5px solid rgba(58,56,54,.14);border-radius:24px;box-shadow:0 10px 26px rgba(58,56,54,.09);padding:22px 26px">
    <span style="flex:none;width:52px;height:52px;border-radius:50%;background:${i % 3 === 1 ? "var(--apricot)" : "var(--teal-deep)"};color:${i % 3 === 1 ? "var(--ink)" : "#fff"};display:flex;align-items:center;justify-content:center;font:500 26px/1 var(--zh)">${esc([...c.name][0])}</span>
    <span><span style="display:block;font:500 28px/1 var(--zh);color:var(--muted);letter-spacing:.04em;margin:2px 0 12px">${esc(c.name)}</span><span style="font:400 40px/1.2 var(--zh);letter-spacing:.02em">${esc(c.text)}</span></span>
  </div>`,
    )
    .join("")}
  <div id="w-note" class="abs" style="left:220px;top:330px;width:640px;padding:30px 0;text-align:center;background:var(--teal-deep);color:#fff;font:500 52px/1 var(--zh);letter-spacing:.06em;box-shadow:0 16px 36px rgba(58,56,54,.18)">${esc(props.note)}</div>`;

  // 第 0 格就有大標，當封面
  const js = [];
  props.comments.forEach((c, i) => {
    const t = ctx.at(c.line, c.at) - 0.1;
    js.push(mv.pop(`#w-c${i}`, t, 0.35));
    ctx.sfx("pop", t, 0.2);
  });
  const noteT = ctx.at(props.noteLine, props.noteAt) - 0.1;
  js.push(mv.out("#w-title", noteT - 0.2, 0.2));
  js.push(mv.stamp("#w-note", noteT, -4));
  ctx.sfx("impact-bass-2", noteT, 0.3);
  return { html, js };
};
