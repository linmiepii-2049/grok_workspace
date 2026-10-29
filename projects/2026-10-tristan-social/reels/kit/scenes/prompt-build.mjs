// Prompt 一段一段長出來：每講一段，空槽變實心、那段文字打進輸入框，下方回覆卡改寫一版
// props: rows: [{ tag, text, line, at, tagAt?, until? }]（at：旁白裡開始念這段內容的詞；兩段在同一句旁白時，用 tagAt 指定標籤亮起的詞、until 指定這段打完並改寫回覆的詞）
//        replies: [v0, v1, ...]（每版是字串，\n 換行）
import { chars, esc, mv, tag } from "../lib.mjs";

export default ({ props, ctx }) => {
  const rowH = 96;
  const html = `
  <div id="b-prompt" class="k-card" style="top:240px">
    <div class="k-head"><span class="k-who">你</span><span class="k-who-name">我的 Prompt</span></div>
    ${props.rows
      .map(
        (r, i) => `<div style="display:flex;align-items:center;gap:24px;height:${rowH}px">
      ${tag(`b-tag${i}`, r.tag, "flex:none")}
      <div id="b-text${i}" style="font:400 44px/1.3 var(--zh);letter-spacing:.02em">${chars(r.text)}</div>
    </div>`,
      )
      .join("")}
  </div>
  <div id="b-reply" class="k-card" style="top:790px;height:340px">
    <div class="k-head"><span class="k-who ai">AI</span><span class="k-who-name">AI 回覆</span>
      <span style="margin-left:auto;position:relative;width:90px;height:44px">
        ${props.replies.map((_, i) => `<span id="b-v${i}" class="abs latin" style="right:0;top:0;font:800 34px/44px var(--latin);color:${i === props.replies.length - 1 ? "var(--coral)" : "var(--teal-ink)"};opacity:${i ? 0 : 1}">v${i}</span>`).join("")}
      </span>
    </div>
    <div style="position:relative">
      ${props.replies.map((r, i) => `<div id="b-r${i}" class="k-reply-body abs" style="left:0;right:0;top:0;font-size:38px;line-height:1.55;opacity:${i ? 0 : 1}${i ? "" : ";color:var(--muted)"}">${esc(r)}</div>`).join("")}
    </div>
  </div>`;

  const js = [mv.grow("#b-prompt", 0, 0.45), mv.grow("#b-reply", 0.15, 0.45)];
  props.rows.forEach((r, i) => {
    const start = ctx.t(r.line);
    const typeAt = ctx.at(r.line, r.at);
    const typeEnd = (r.until ? ctx.at(r.line, r.until) - 0.35 : ctx.end(r.line)) - 0.15;
    const tagT = r.tagAt ? ctx.at(r.line, r.tagAt) - 0.3 : start + 0.1;
    js.push(mv.fillTag(`#b-tag${i}`, tagT));
    js.push(mv.type(`#b-text${i}`, typeAt, Math.max(0.4, typeEnd - typeAt)));
    // 回覆改寫：舊版退場、新版由左往右刷出來，版本號換掉
    const swap = typeEnd + 0.2;
    js.push(mv.out(`#b-r${i}`, swap, 0.15));
    js.push(mv.wipeRight(`#b-r${i + 1}`, swap + 0.1, 0.5));
    js.push(mv.show(`#b-r${i + 1}`, swap + 0.1));
    js.push(mv.out(`#b-v${i}`, swap, 0.1));
    js.push(mv.pop(`#b-v${i + 1}`, swap + 0.1, 0.3));
    ctx.sfx("pop", tagT, 0.25);
    ctx.sfx("typing", typeAt, 0.15, Math.max(0.4, typeEnd - typeAt));
    ctx.sfx("click-soft", swap + 0.1, 0.25);
  });
  return { html, js };
};
