// 換個角度：A ＝ B 的比喻等式，下面排出空的標籤槽
// props: top, bottom（**重點** 用磚紅）, topAt, eqAt, bottomAt（旁白裡的詞）, slots（標籤名稱陣列）, lines: [比喻句, 帶出標籤的句子]
import { em, mv, tag } from "../lib.mjs";

export default ({ props, ctx }) => {
  const [l1, l2] = props.lines;
  const w = 200, gap = 24;
  const left = (1080 - (props.slots.length * w + (props.slots.length - 1) * gap)) / 2;
  const html = `
  <div id="e-top" class="k-title" style="top:300px"><span class="s">${em(props.top)}</span></div>
  <div id="e-eq" class="abs latin" style="left:0;right:0;top:500px;text-align:center;font:500 120px/1 var(--latin);color:var(--teal-ink)">=</div>
  <div id="e-bottom" class="k-title" style="top:660px"><span class="s">${em(props.bottom)}</span></div>
  ${props.slots.map((s, i) => tag(`e-slot${i}`, s, `position:absolute;top:960px;left:${left + i * (w + gap)}px;width:${w}px;height:96px;font-size:40px`)).join("")}`;
  const js = [
    mv.wipeUp("#e-top", ctx.at(l1, props.topAt) - 0.15),
    mv.pop("#e-eq", ctx.at(l1, props.eqAt) - 0.1),
    mv.wipeUp("#e-bottom", ctx.at(l1, props.bottomAt) - 0.15),
    ...props.slots.map((_, i) => mv.pop(`#e-slot${i}`, ctx.at(l2, props.slotsAt) + i * 0.12, 0.3)),
  ];
  ctx.sfx("click-soft", ctx.at(l1, props.eqAt) - 0.1, 0.3);
  props.slots.forEach((_, i) => ctx.sfx("pop", ctx.at(l2, props.slotsAt) + i * 0.12, 0.18));
  return { html, js };
};
