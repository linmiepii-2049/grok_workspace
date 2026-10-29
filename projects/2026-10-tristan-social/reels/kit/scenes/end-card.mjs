// 片尾 CTA：形象照放進灰綠圓、帳號、留言關鍵字
// 形象照刻意放小（直徑 266px）：本人不想讓照片太搶眼（2026-10-29 使用者要求縮小 30%）
// props: title, sub, line, titleAt, subAt；照片與帳號來自 carousel/profile.json
import { em, esc, mv } from "../lib.mjs";

export default ({ props, ctx }) => {
  const l = props.line;
  const html = `
  <div id="c-photo" class="abs" style="left:407px;top:280px;width:266px;height:266px;border-radius:50%;background:var(--teal);overflow:hidden">
    <img src="${ctx.profile.photo}" alt="" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover">
  </div>
  <div id="c-name" class="abs latin" style="left:0;right:0;top:600px;text-align:center;font:800 44px/1 var(--latin);letter-spacing:.24em;color:var(--ink)">${esc(ctx.profile.author.toUpperCase())}</div>
  <div id="c-handle" class="abs latin" style="left:0;right:0;top:664px;text-align:center;font:500 32px/1 var(--latin);letter-spacing:.06em;color:var(--muted)">${esc(ctx.profile.handle)}</div>
  <div id="c-title" class="k-title" style="top:750px"><span class="s">${em(props.title)}</span></div>
  <div id="c-sub" class="abs" style="left:0;right:0;top:990px;text-align:center;font:400 38px/1 var(--zh);letter-spacing:.04em;color:var(--teal-ink)">${esc(props.sub)}</div>`;
  const js = [
    mv.pop("#c-photo", 0, 0.5),
    mv.wipeRight("#c-name", 0.3, 0.4),
    mv.wipeRight("#c-handle", 0.45, 0.4),
    mv.wipeUp("#c-title", ctx.at(l, props.titleAt) - 0.3, 0.5),
    mv.wipeUp("#c-sub", ctx.at(l, props.subAt) - 0.2, 0.4),
  ];
  ctx.sfx("chime", ctx.at(l, props.titleAt) - 0.3, 0.3);
  return { html, js };
};
