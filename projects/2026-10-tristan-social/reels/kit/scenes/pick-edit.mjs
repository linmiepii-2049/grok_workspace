// 人的判斷：兩版回覆，圈選一版，再改其中一句；下面一句大標
// props: a, b（字串，用 [[原句]] 標出要改的那句）, fix（改成的說法）, title, line, pickAt, editAt, titleAt
import { em, esc, ink, mv } from "../lib.mjs";

export default ({ props, ctx }) => {
  const l = props.line;
  const card = (id, label, text, top) => `
  <div id="${id}" class="k-card" style="top:${top}px;padding:28px 40px ${label === "B" ? 76 : 28}px 110px">
    <div class="abs latin" style="left:40px;top:30px;font:800 40px/1 var(--latin);color:var(--teal-ink)">${label}</div>
    <div class="k-reply-body" style="font-size:34px;line-height:1.6">${text}</div>
  </div>`;
  const b = esc(props.b).replace(/\[\[(.+?)\]\]/, `<span id="k-old" style="position:relative;display:inline-block">$1<svg id="k-oldx" class="k-ink" style="left:-4px;top:46%;width:calc(100% + 8px);height:6px" viewBox="0 0 100 6" preserveAspectRatio="none"><path pathLength="1" d="M0 3 L100 3" style="stroke-width:5"/></svg><span id="k-fix" class="abs" data-layout-allow-overflow style="left:0;top:110%;white-space:nowrap;font:500 38px/1 var(--zh);color:var(--coral)">${esc(props.fix)}</span></span>`);
  const html = `
  ${card("k-a", "A", esc(props.a), 250)}
  ${card("k-b", "B", b, 600)}
  ${ink("k-circle", { left: 50, top: 570, w: 980, h: 360 }, "M50 3 C 80 2, 99 20, 98 52 C 97 85, 75 98, 46 97 C 18 96, 1 80, 2 48 C 3 20, 25 5, 55 6")}
  <div id="k-title" class="k-title" style="top:960px"><span class="s" style="font-size:112px">${em(props.title)}</span></div>`;
  const js = [
    mv.grow("#k-a", 0, 0.4),
    mv.grow("#k-b", 0.15, 0.4),
    mv.draw("#k-circle path", ctx.at(l, props.pickAt) - 0.1, 0.55),
    mv.dim("#k-a", ctx.at(l, props.pickAt) + 0.3, 0.4),
    mv.draw("#k-oldx path", ctx.at(l, props.editAt) - 0.1, 0.25),
    mv.wipeRight("#k-fix", ctx.at(l, props.editAt) + 0.2, 0.45),
    mv.wipeUp("#k-title", ctx.at(l, props.titleAt) - 0.3, 0.5),
  ];
  ctx.sfx("whoosh-short", ctx.at(l, props.pickAt) - 0.1, 0.25);
  ctx.sfx("key-press", ctx.at(l, props.editAt) + 0.2, 0.3);
  return { html, js };
};
