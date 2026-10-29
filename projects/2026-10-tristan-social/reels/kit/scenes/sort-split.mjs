// 人的判斷：卡片分成左右兩欄（例如「交給 AI」和「留給你」），最後落下大標
// props: left: { head, at, items }, right: { head, at, items }（head 可用 **重點**）, title, titleAt, line
import { em, esc, mv } from "../lib.mjs";

export default ({ props, ctx }) => {
  const l = props.line;
  const col = (side, c, x) => `
  <div id="s-${side}-h" class="abs" style="left:${x}px;top:250px;width:440px;text-align:center;font:300 64px/1.2 var(--zh);letter-spacing:.06em;padding-bottom:18px;border-bottom:4px solid ${side === "l" ? "var(--teal)" : "var(--coral)"}">${em(c.head)}</div>
  ${c.items
    .map(
      (t, i) => `<div id="s-${side}${i}" class="abs" style="left:${x}px;top:${380 + i * 128}px;width:440px;padding:26px 0;text-align:center;background:var(--card);border:1.5px solid rgba(58,56,54,.14);border-radius:20px;box-shadow:0 10px 26px rgba(58,56,54,.09);font:400 40px/1 var(--zh);letter-spacing:.02em">${esc(t)}</div>`,
    )
    .join("")}`;
  const html = `
  ${col("l", props.left, 80)}
  ${col("r", props.right, 560)}
  <div id="s-title" class="k-title" style="top:820px"><span class="s" style="font-size:112px">${em(props.title)}</span></div>`;

  const js = [];
  for (const [side, c, dx] of [["l", props.left, -260], ["r", props.right, 260]]) {
    const t = ctx.at(l, c.at) - 0.25;
    js.push(mv.wipeUp(`#s-${side}-h`, t, 0.4));
    c.items.forEach((_, i) => js.push(mv.fly(`#s-${side}${i}`, t + 0.2 + i * 0.14, dx, 0, 0.45), mv.show(`#s-${side}${i}`, t + 0.2 + i * 0.14)));
    ctx.sfx("whoosh-short", t + 0.2, 0.25);
  }
  js.push(mv.wipeUp("#s-title", ctx.at(l, props.titleAt) - 0.3, 0.5));
  ctx.sfx("chime", ctx.at(l, props.titleAt) - 0.3, 0.25);
  return { html, js };
};
