// 投資追蹤前端：無框架；分頁用 hash：#overview · #holdings · #realized · #briefs · #briefs/<日期> · #calendar
const app = document.getElementById("app");
const tip = document.querySelector(".pf-tip");

// ---------- 工具 ----------

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const twd = (n, { sign = false } = {}) => {
  if (n == null) return "—";
  const s = Math.round(Math.abs(n)).toLocaleString("zh-TW");
  return `${n < 0 ? "−" : sign && n > 0 ? "+" : ""}${s}`;
};
const pct = (n, { sign = true } = {}) =>
  n == null
    ? "—"
    : `${n < 0 ? "−" : sign && n > 0 ? "+" : ""}${Math.abs(n * 100).toFixed(2)}%`;
const usd = (n, { sign = false, cents = true } = {}) => {
  if (n == null) return "—";
  const d = cents ? 2 : 0;
  const s = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return `${n < 0 ? "−" : sign && n > 0 ? "+" : ""}$${s}`;
};
const qty = (n) =>
  Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 4 });
const px = (n) =>
  Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 2 });

// 漲跌：紅漲綠跌＋▲▼，不只靠顏色
const move = (n, text) =>
  n == null || Math.abs(n) < 1e-9
    ? `<span class="num">${text}</span>`
    : `<span class="num ${n > 0 ? "up" : "down"}">${n > 0 ? "▲" : "▼"} ${text}</span>`;

const shortDate = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const WEEK = "日一二三四五六";
const weekday = (d) => WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()];

async function api(path) {
  const res = await fetch(path, {
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), {
      status: res.status,
    });
  return body;
}

// 主題切換與成品庫共用同一個 localStorage 鍵
const THEMES = ["auto", "light", "dark"];
const THEME_LABEL = { auto: "自動", light: "淺色", dark: "深色" };
const readTheme = () => {
  try {
    return localStorage.getItem("theme") || "auto";
  } catch {
    return "auto";
  }
};
const applyTheme = (t) => {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
};
applyTheme(readTheme());

// ---------- 迷你 Markdown（晨報用）----------

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      (_, t, u) =>
        `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`,
    );
}

function markdown(md) {
  const out = [];
  let list = null;
  const close = () => {
    if (list)
      out.push(
        `<${list}>${out.splice(out.lastIndexOf("@@list"), Infinity).slice(1).join("")}</${list}>`,
      );
    list = null;
  };
  for (const line of md.split("\n")) {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const li =
      line.match(/^\s*[-*]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) {
      close();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (li) {
      const type = /^\s*\d+\./.test(line) ? "ol" : "ul";
      if (list !== type) {
        close();
        list = type;
        out.push("@@list");
      }
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (line.trim()) {
      close();
      out.push(`<p>${inline(line)}</p>`);
    } else close();
  }
  close();
  return out.join("\n");
}

// ---------- 折線圖（SVG＋十字線提示）----------

/**
 * @param series [{ name, color, values: number[] }]，與 dates 等長
 * @param fmt    數值格式
 */
function lineChart({
  dates,
  series,
  fmt,
  area = false,
  zero = false,
  height = 220,
}) {
  const id = `c${Math.random().toString(36).slice(2, 8)}`;
  charts.set(id, { dates, series, fmt, area, zero, height });
  return `<div class="pf-chart" id="${id}" tabindex="0" role="img" aria-label="${esc(series.map((s) => s.name).join("、"))}走勢圖，可用左右鍵查看每天數值"></div>`;
}

const charts = new Map();

function niceTicks(min, max, count = 4) {
  if (min === max) [min, max] = [min - 1, max + 1];
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step)
    ticks.push(Math.round(v / step) * step);
  return ticks;
}

function drawChart(el) {
  const c = charts.get(el.id);
  if (!c) return;
  const W = el.clientWidth || 320;
  const H = c.height;
  const pad = { t: 10, r: 46, b: 22, l: 8 };
  const all = c.series.flatMap((s) => s.values).filter((v) => v != null);
  if (c.zero) all.push(0);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const yMin = ticks[0];
  const yMax = ticks.at(-1);
  const n = c.dates.length;
  const x = (i) => pad.l + (n === 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v) =>
    pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`,
    )
    .join("");
  const yLabels = ticks
    .map(
      (t) =>
        `<text x="${W - pad.r + 6}" y="${y(t) + 4}">${esc(c.fmt(t, true))}</text>`,
    )
    .join("");
  const xIdx = [...new Set([0, Math.round((n - 1) / 2), n - 1])];
  const xLabels = xIdx
    .map(
      (i, k) =>
        `<text x="${x(i)}" y="${H - 4}" text-anchor="${k === 0 ? "start" : k === xIdx.length - 1 ? "end" : "middle"}">${shortDate(c.dates[i])}</text>`,
    )
    .join("");

  const paths = c.series
    .map((s) => {
      const d = s.values
        .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
        .filter(Boolean);
      const line = `<polyline class="series" points="${d.join(" ")}" style="stroke:${s.color}"/>`;
      const fill = c.area
        ? `<polygon class="area" points="${x(0)},${y(yMin)} ${d.join(" ")} ${x(n - 1)},${y(yMin)}" style="fill:${s.color}"/>`
        : "";
      return fill + line;
    })
    .join("");
  // 多條線時在右端標名稱（≤ 4 條），讓辨識不只靠顏色
  const ends =
    c.series.length > 1
      ? c.series
          .map((s) => {
            const v = s.values.at(-1);
            return v == null
              ? ""
              : `<circle cx="${x(n - 1)}" cy="${y(v)}" r="3" style="fill:${s.color}"/>`;
          })
          .join("")
      : "";
  const zeroLine =
    c.zero && yMin < 0
      ? `<line class="zero" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`
      : "";

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" aria-hidden="true">
    <g class="grid">${grid}</g>${zeroLine}${paths}${ends}
    <g class="axis">${yLabels}${xLabels}</g>
    <line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
    <g class="dots"></g>
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
  </svg>`;

  const svg = el.querySelector("svg");
  const cross = svg.querySelector(".cross");
  const dots = svg.querySelector(".dots");
  const show = (i, clientX, clientY) => {
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    dots.innerHTML = c.series
      .map((s) =>
        s.values[i] == null
          ? ""
          : `<circle class="dot" cx="${x(i)}" cy="${y(s.values[i])}" r="4.5" style="fill:${s.color}"/>`,
      )
      .join("");
    tip.replaceChildren();
    const d = Object.assign(document.createElement("div"), {
      className: "d",
      textContent: `${c.dates[i]}（${weekday(c.dates[i])}）`,
    });
    tip.append(d);
    for (const s of c.series) {
      const row = Object.assign(document.createElement("div"), {
        className: "row",
      });
      const key = document.createElement("i");
      key.style.setProperty("--c", s.color);
      row.append(
        key,
        Object.assign(document.createElement("b"), {
          textContent: c.fmt(s.values[i]),
        }),
      );
      if (c.series.length > 1)
        row.append(
          Object.assign(document.createElement("span"), {
            textContent: s.name,
          }),
        );
      tip.append(row);
    }
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, clientX - r.width / 2),
      innerWidth - r.width - 8,
    );
    const top =
      clientY - r.height - 14 < 8 ? clientY + 18 : clientY - r.height - 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    dots.innerHTML = "";
    tip.hidden = true;
  };
  const indexAt = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    return Math.max(
      0,
      Math.min(
        n - 1,
        Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1)),
      ),
    );
  };
  svg.addEventListener("pointermove", (e) =>
    show(indexAt(e.clientX), e.clientX, e.clientY),
  );
  svg.addEventListener("pointerleave", hide);
  let focusIdx = n - 1;
  el.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    focusIdx = Math.max(
      0,
      Math.min(n - 1, focusIdx + (e.key === "ArrowLeft" ? -1 : 1)),
    );
    const box = svg.getBoundingClientRect();
    show(focusIdx, box.left + (x(focusIdx) / W) * box.width, box.top + 20);
  };
  el.onblur = hide;
}

function drawCharts() {
  for (const el of app.querySelectorAll(".pf-chart")) drawChart(el);
}
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawCharts, 150);
});

// ---------- 版面 ----------

const TABS = [
  ["overview", "總覽"],
  ["holdings", "持股"],
  ["realized", "已實現"],
  ["briefs", "晨報"],
  ["calendar", "行事曆"],
];

let summary = null;

function header(active) {
  const s = summary.series;
  const last = s.at(-1);
  const prev = s.at(-2);
  const day = last && prev ? last.total - prev.total - last.net_flow : null;
  return `
    <div class="topbar">
      <a class="back" href="/">← 成品庫</a>
      <button class="theme-toggle" type="button" data-action="theme" aria-label="切換主題，目前${THEME_LABEL[readTheme()]}">${THEME_LABEL[readTheme()]}</button>
    </div>
    <header class="pf-head">
      <span class="mono">PORTFOLIO · ${last ? `${last.date}（${weekday(last.date)}）收盤` : "尚無資料"}</span>
      <div class="pf-hero num">${last ? twd(last.total) : "—"}<small>元</small></div>
      <div class="pf-day">今日 ${day == null ? "—" : move(day, `${twd(day, { sign: true })}（${pct(day / prev.total)}）`)}</div>
    </header>
    <nav class="pf-tabs" aria-label="投資追蹤分頁">
      ${TABS.map(([k, label]) => `<a href="#${k}"${k === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    </nav>`;
}

function stat(label, valueHtml, sub = "") {
  return `<div class="pf-stat"><span class="label">${label}</span><span class="value">${valueHtml}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
}

function overview() {
  const s = summary.series;
  const last = s.at(-1);
  if (!last)
    return `<p class="empty-state">還沒有資料。把 ledger.yaml 填好推上 main，排程跑完就會出現。</p>`;
  const profit = last.unrealized + last.realized_cum + last.income_cum;
  const dates = s.map((r) => r.date);

  // 大類配置：台股、美股、台幣現金、美元現金（台幣計價）
  const cashCcy = summary.cash_by_ccy ?? {};
  const mvOf = (ccy) =>
    summary.positions
      .filter((p) => p.currency === ccy)
      .reduce((sum, p) => sum + p.market_value, 0);
  const alloc = [
    { name: "台股", value: mvOf("TWD") },
    { name: "美股", value: mvOf("USD") },
    { name: "台幣現金", value: cashCcy.TWD ?? 0, cash: true },
    { name: "美元現金", value: (cashCcy.USD ?? 0) * last.fx_usd, cash: true },
  ].filter((a) => a.value > 0);

  const charts =
    s.length < 2
      ? `<div class="pf-card"><h2>資產走勢</h2><p class="hint">目前只有 ${s.length} 天的資料，累積兩個交易日後會出現走勢圖。</p></div>`
      : `
    <section class="pf-card">
      <h2>總資產</h2>
      <p class="hint">含現金，台幣計價</p>
      ${lineChart({ dates, series: [{ name: "總資產", color: "var(--s1)", values: s.map((r) => r.total) }], fmt: (v, axis) => (axis ? compact(v) : `${twd(v)} 元`), area: true })}
      ${tableView(
        ["日期", "總資產", "當日入出金"],
        s.map((r) => [r.date, twd(r.total), twd(r.net_flow, { sign: true })]),
      )}
    </section>
    <section class="pf-card">
      <h2>報酬率比較</h2>
      <p class="hint">時間加權報酬率，已排除入金出金；比較基準換算成台幣</p>
      <div class="pf-legend"><span style="--c:var(--s1)">我的組合</span><span style="--c:var(--s2)">0050</span><span style="--c:var(--s3)">VOO</span></div>
      ${lineChart({
        dates,
        zero: true,
        series: [
          { name: "我的組合", color: "var(--s1)", values: s.map((r) => r.twr) },
          {
            name: "0050",
            color: "var(--s2)",
            values: s.map((r) => r.bench["0050.TW"] ?? null),
          },
          {
            name: "VOO",
            color: "var(--s3)",
            values: s.map((r) => r.bench.VOO ?? null),
          },
        ],
        fmt: (v, axis) =>
          v == null ? "—" : axis ? `${(v * 100).toFixed(0)}%` : pct(v),
      })}
      ${tableView(
        ["日期", "我的組合", "0050", "VOO"],
        s.map((r) => [
          r.date,
          pct(r.twr),
          pct(r.bench["0050.TW"]),
          pct(r.bench.VOO),
        ]),
      )}
    </section>`;

  return `
    <div class="pf-stats">
      ${stat("累積損益", move(profit, twd(profit, { sign: true })), "未實現＋已實現＋股利利息")}
      ${stat("報酬率（TWR）", move(last.twr, pct(last.twr)), `起始日 ${s[0].date} 至今`)}
      ${stat("未實現損益", move(last.unrealized, twd(last.unrealized, { sign: true })), `持股成本 ${twd(last.cost)} · 已扣預估賣出費用`)}
      ${stat("已實現＋股利", move(last.realized_cum + last.income_cum, twd(last.realized_cum + last.income_cum, { sign: true })), `美元匯率 ${last.fx_usd}`)}
    </div>
    <section class="pf-card">
      <h2>資產配置</h2>
      <p class="hint">台幣計價，美元匯率 ${last.fx_usd}</p>
      ${allocBars(
        alloc.map((a) => ({
          label: esc(a.name),
          value: a.value,
          valueText: `${twd(a.value)} 元`,
          cash: a.cash,
        })),
        last.total,
      )}
    </section>
    ${marketSection("TWD", cashCcy.TWD ?? 0)}
    ${marketSection("USD", cashCcy.USD ?? 0)}
    ${charts}`;
}

// 配置長條：weight 以 total 為分母
function allocBars(rows, total) {
  return `<div class="pf-alloc">${rows
    .map((r) => {
      const w = total ? r.value / total : 0;
      return `<div class="row${r.cash ? " cash" : ""}">
        <span>${r.label}</span>
        <span class="num">${(w * 100).toFixed(1)}%　${r.valueText}</span>
        <span class="bar"><i style="width:${Math.max(0.5, w * 100)}%"></i></span>
      </div>`;
    })
    .join("")}</div>`;
}

// 各市場用自己的幣別：市值、今日漲跌、未實現（美股只算股價部分，匯率影響只反映在台幣總資產）
// 未實現扣掉預估賣出手續費與證交稅（sell_cost，原幣），和券商的「參考損益」一致
const MARKET = {
  TWD: { title: "台股", unit: "元", fmt: (n, o) => twd(n, o), short: (n, o) => twd(n, o) },
  USD: { title: "美股", unit: "美元", fmt: (n, o) => usd(n, o), short: (n, o) => usd(n, { ...o, cents: false }) },
};

function marketSection(ccy, cash) {
  const m = MARKET[ccy];
  const ps = summary.positions
    .filter((p) => p.currency === ccy)
    .map((p) => ({
      ...p,
      mv: p.shares * p.close,
      costN: p.shares * p.avg_cost,
      sellN: p.sell_cost ?? 0,
      dayN: p.prev_close == null ? null : p.shares * (p.close - p.prev_close),
    }))
    .sort((a, b) => b.mv - a.mv);
  if (!ps.length && !cash) return "";
  const mv = ps.reduce((s, p) => s + p.mv, 0);
  const cost = ps.reduce((s, p) => s + p.costN, 0);
  const unreal = mv - ps.reduce((s, p) => s + p.sellN, 0) - cost;
  const known = ps.filter((p) => p.dayN != null);
  const day = known.length ? known.reduce((s, p) => s + p.dayN, 0) : null;
  const dayBase = known.reduce((s, p) => s + p.shares * p.prev_close, 0);

  return `<section class="pf-card pf-market">
    <h2>${m.title}<span class="mono">　${ccy}</span></h2>
    <div class="pf-stats">
      ${stat("市值", `<span class="num">${m.fmt(mv)}</span>`, m.unit)}
      ${stat("今日", day == null ? "—" : move(day, m.fmt(day, { sign: true })), day == null || !dayBase ? "" : pct(day / dayBase))}
      ${stat("未實現損益", move(unreal, m.fmt(unreal, { sign: true })), cost ? `${pct(unreal / cost)} · 成本 ${m.fmt(cost)}` : "")}
      ${stat("現金", `<span class="num">${m.fmt(cash)}</span>`, m.unit)}
    </div>
    ${
      ps.length
        ? `<div class="pf-scroll"><table class="pf">
      <thead><tr><th>持股</th><th>市值</th><th>今日</th><th>未實現</th><th>占${m.title}</th></tr></thead>
      <tbody>${ps
        .map((p) => {
          const chg = p.prev_close ? p.close / p.prev_close - 1 : null;
          const u = p.mv - p.sellN - p.costN;
          return `<tr>
            <td>${esc(p.name)}<br><span class="mono">${esc(p.symbol.replace(/\.TWO?$/, ""))}</span></td>
            <td class="num">${m.short(p.mv)}</td>
            <td>${move(chg, pct(chg))}</td>
            <td>${move(u, m.short(u, { sign: true }))}<br><span class="mono">${p.costN ? pct(u / p.costN) : ""}</span></td>
            <td class="num">${mv ? ((p.mv / mv) * 100).toFixed(1) : "0.0"}%</td>
          </tr>`;
        })
        .join("")}</tbody></table></div>`
        : ""
    }
  </section>`;
}

const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}億`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString("zh-TW")}萬`;
  return String(Math.round(v));
};

function tableView(head, rows) {
  return `<details class="pf-table"><summary>表格檢視</summary><div class="pf-scroll"><table class="pf">
    <thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .slice()
      .reverse()
      .map(
        (r) =>
          `<tr>${r.map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`,
      )
      .join("")}</tbody></table></div></details>`;
}

function holdings() {
  const ps = summary.positions;
  if (!ps.length) return `<p class="empty-state">目前沒有持股。</p>`;
  return `<div class="pf-holdings">${ps
    .map((p) => {
      const chg = p.prev_close ? p.close / p.prev_close - 1 : null;
      const usd = p.currency === "USD";
      return `<article class="pf-holding">
        <header>
          <h3>${esc(p.name)}<span class="mono">${esc(p.symbol)}</span></h3>
          ${move(chg, pct(chg))}
        </header>
        <dl>
          <dt>市值（台幣）</dt><dt>未實現損益</dt>
          <dd class="num">${twd(p.market_value)}</dd>
          <dd>${move(p.unrealized, twd(p.unrealized, { sign: true }))}${p.cost ? ` <span class="num">（${pct(p.unrealized / p.cost)}）</span>` : ""}</dd>
          <dt>股數 · 帳戶</dt><dt>收盤 / 成本均價${usd ? "（美元）" : ""}</dt>
          <dd class="num">${qty(p.shares)} · ${esc(p.account)}</dd>
          <dd class="num">${px(p.close)} / ${px(p.avg_cost)}</dd>
          ${
            usd
              ? `<dt>股價損益</dt><dt>匯率損益</dt>
          <dd>${move(p.unreal_price, twd(p.unreal_price, { sign: true }))}</dd>
          <dd>${move(p.unreal_fx, twd(p.unreal_fx, { sign: true }))}</dd>`
              : ""
          }
        </dl>
        <details data-news="${esc(p.symbol)}"><summary>相關新聞</summary><div class="news-body"><p class="mono">載入中…</p></div></details>
      </article>`;
    })
    .join("")}</div>`;
}

async function loadNews(details) {
  const body = details.querySelector(".news-body");
  if (body.dataset.loaded) return;
  body.dataset.loaded = "1";
  try {
    const news = await api(
      `/api/portfolio/news?symbol=${encodeURIComponent(details.dataset.news)}`,
    );
    body.innerHTML = news.length
      ? `<ul class="pf-news">${news
          .map(
            (
              n,
            ) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
              <span class="mono">${esc(n.source || "")} · ${new Date(n.published_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span></li>`,
          )
          .join("")}</ul>`
      : `<p class="mono">最近沒有收錄到新聞</p>`;
  } catch (e) {
    body.innerHTML = `<p class="mono">讀取失敗：${esc(e.message)}</p>`;
  }
}

function realized() {
  const r = summary.realized;
  const last = summary.series.at(-1);
  const total = r.reduce((s, x) => s + x.pnl, 0);
  return `
    <div class="pf-stats">
      ${stat("已實現損益", move(total, twd(total, { sign: true })), `${r.length} 筆賣出`)}
      ${stat("股利＋利息", move(last?.income_cum, twd(last?.income_cum ?? 0, { sign: true })), "稅後")}
    </div>
    ${
      r.length
        ? `<div class="pf-scroll"><table class="pf">
      <thead><tr><th>日期 · 股票</th><th>股數</th><th>賣出淨額</th><th>成本</th><th>損益</th><th>其中匯率</th></tr></thead>
      <tbody>${r
        .map(
          (
            x,
          ) => `<tr><td>${esc(x.date)}<br><span class="mono">${esc(x.symbol)} · ${esc(x.account)}</span></td>
            <td class="num">${qty(x.shares)}</td><td class="num">${twd(x.proceeds)}</td><td class="num">${twd(x.cost)}</td>
            <td>${move(x.pnl, twd(x.pnl, { sign: true }))}</td>
            <td class="num">${x.symbol.match(/\.TWO?$/) ? "—" : twd(x.pnl_fx, { sign: true })}</td></tr>`,
        )
        .join("")}</tbody></table></div>`
        : `<p class="empty-state">還沒有賣出紀錄。</p>`
    }`;
}

async function briefs(date) {
  if (date) {
    const b = await api(`/api/portfolio/briefs/${encodeURIComponent(date)}`);
    return `<p><a class="back" href="#briefs">← 所有晨報</a></p>
      <article class="pf-article"><span class="mono">${esc(b.date)}（${weekday(b.date)}）· ${esc(b.model)}</span>${markdown(b.body)}</article>`;
  }
  const list = await api("/api/portfolio/briefs");
  return list.length
    ? `<ul class="pf-list">${list
        .map(
          (b) =>
            `<li><a href="#briefs/${esc(b.date)}"><span class="mono">${esc(b.date)}（${weekday(b.date)}）</span><strong>${esc(b.title)}</strong></a></li>`,
        )
        .join("")}</ul>`
    : `<p class="empty-state">還沒有晨報。排程在週二到週六早上 6 點產生。</p>`;
}

const KIND_LABEL = {
  earnings: "財報",
  exdiv: "除息",
  macro: "總經",
  revenue: "營收",
};
let onlyMine = true;

async function calendar() {
  const events = await api("/api/portfolio/events?days=30");
  const mine = new Set(summary.positions.map((p) => p.symbol));
  const shown = events.filter(
    (e) => !onlyMine || !e.symbol || mine.has(e.symbol),
  );
  const byDate = Object.groupBy
    ? Object.groupBy(shown, (e) => e.date)
    : shown.reduce((m, e) => ((m[e.date] ??= []).push(e), m), {});
  return `
    <div class="pf-filter">
      <button class="chip" type="button" data-action="mine" aria-pressed="${onlyMine}">只看持股與總經</button>
      <button class="chip" type="button" data-action="all" aria-pressed="${!onlyMine}">全部</button>
    </div>
    ${
      shown.length
        ? Object.entries(byDate)
            .map(
              ([d, es]) =>
                `<section class="pf-day-group"><h3>${d}（${weekday(d)}）</h3>${es
                  .map(
                    (
                      e,
                    ) => `<div class="pf-event"><span class="tag" data-kind="${e.kind}">${KIND_LABEL[e.kind] ?? e.kind}</span>
                    <strong>${esc(e.title)}</strong><small>${esc(e.detail || "")}</small></div>`,
                  )
                  .join("")}</section>`,
            )
            .join("")
        : `<p class="empty-state">未來 30 天沒有事件。</p>`
    }`;
}

// ---------- 路由 ----------

async function render() {
  const [tab = "overview", arg] = location.hash.slice(1).split("/");
  charts.clear();
  tip.hidden = true;
  try {
    summary ??= await api("/api/portfolio/summary");
    let body;
    if (tab === "holdings") body = holdings();
    else if (tab === "realized") body = realized();
    else if (tab === "briefs") body = await briefs(arg);
    else if (tab === "calendar") body = await calendar();
    else body = overview();
    app.innerHTML =
      header(TABS.some(([k]) => k === tab) ? tab : "overview") + body;
    drawCharts();
  } catch (e) {
    app.innerHTML = `<div class="notice"><h1>讀取失敗</h1><p>${esc(e.status === 401 ? "請重新登入" : e.message)}</p></div>`;
  }
}

app.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "theme") {
    const next = THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length];
    try {
      localStorage.setItem("theme", next);
    } catch {}
    applyTheme(next);
    btn.textContent = THEME_LABEL[next];
    btn.setAttribute("aria-label", `切換主題，目前${THEME_LABEL[next]}`);
  }
  if (btn.dataset.action === "mine" || btn.dataset.action === "all") {
    onlyMine = btn.dataset.action === "mine";
    render();
  }
});

app.addEventListener(
  "toggle",
  (e) => {
    if (e.target.matches("details[data-news]") && e.target.open)
      loadNews(e.target);
  },
  true,
);

addEventListener("hashchange", () => {
  render();
  scrollTo(0, 0);
});
render();
