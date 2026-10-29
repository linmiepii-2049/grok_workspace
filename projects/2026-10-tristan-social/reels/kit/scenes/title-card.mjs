// 轉場大標：小字引言先出，接著大標由下往上揭開
// props: kicker, kickerAt, title（**重點** 用磚紅）, titleAt, lines: [引言句, 大標句]
import { em, esc, mv } from "../lib.mjs";

export default ({ props, ctx }) => {
  const [l1, l2 = l1] = props.lines;
  const html = `
  <div id="tc-kicker" class="abs" style="left:0;right:0;top:420px;text-align:center;font:500 46px/1 var(--zh);letter-spacing:.12em;color:var(--teal-ink)">${esc(props.kicker)}</div>
  <div id="tc-line" class="abs" style="left:500px;top:500px;width:80px;height:4px;background:var(--apricot)"></div>
  <div id="tc-title" class="k-title" style="top:580px"><span class="s">${em(props.title)}</span></div>`;
  const kt = ctx.at(l1, props.kickerAt) - 0.15;
  const tt = ctx.at(l2, props.titleAt) - 0.3;
  const js = [mv.wipeUp("#tc-kicker", kt, 0.45), mv.wipeRight("#tc-line", kt + 0.2, 0.35), mv.wipeUp("#tc-title", tt, 0.55)];
  ctx.sfx("whoosh-short", kt, 0.25);
  ctx.sfx("click-soft", tt, 0.3);
  return { html, js };
};
