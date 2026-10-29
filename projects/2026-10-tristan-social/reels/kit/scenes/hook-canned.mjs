// 鉤子：一句太短的 Prompt，AI 回一封罐頭信，蓋章、劃掉，落下大標
// props: prompt, reply（字串陣列）, stamp, stampAt（旁白裡的詞）, title, titleAt, lines: [問句, 轉折]
import { chars, em, esc, ink, mv } from "../lib.mjs";

export default ({ props, ctx }) => {
  const [l1, l2] = props.lines;
  const html = `
  <div id="h-prompt" class="k-card" style="top:250px">
    <div class="k-head"><span class="k-who">你</span><span class="k-who-name">我的 Prompt</span></div>
    <div class="k-prompt-text">${esc(props.prompt)}</div>
  </div>
  <div id="h-reply" class="k-card" style="top:540px">
    <div class="k-head"><span class="k-who ai">AI</span><span class="k-who-name">AI 回覆</span></div>
    <div class="k-reply-body">${props.reply.map((r, i) => `<div id="h-r${i}">${esc(r)}</div>`).join("")}</div>
  </div>
  <div id="h-stamp" class="k-stamp" style="right:120px;top:640px">${esc(props.stamp)}</div>
  ${ink("h-strike", { left: 150, top: 620, w: 780, h: 330 }, "M4 90 C 30 70, 60 35, 96 8 M 10 60 C 40 50, 70 30, 92 30")}
  <div id="h-title" class="k-title" style="top:1010px"><span class="s">${em(props.title)}</span></div>`;

  const js = [
    // 第 0 格就有 Prompt 和回覆卡頭，當封面
    ...props.reply.map((_, i) => mv.wipeRight(`#h-r${i}`, 0.25 + i * 0.16, 0.3)),
    mv.stamp("#h-stamp", ctx.at(l1, props.stampAt) - 0.05),
    mv.draw("#h-strike path", ctx.t(l2) - 0.05, 0.45),
    mv.dim("#h-reply", ctx.t(l2) + 0.3, 0.4),
    mv.dim("#h-stamp", ctx.t(l2) + 0.3, 0.4),
    mv.wipeUp("#h-title", ctx.at(l2, props.titleAt) - 0.35, 0.5),
  ];
  ctx.sfx("typing", 0.2, 0.25, 1.0);
  ctx.sfx("impact-bass-2", ctx.at(l1, props.stampAt) - 0.05, 0.35);
  ctx.sfx("whoosh-short", ctx.t(l2) - 0.05, 0.3);
  return { html, js };
};
