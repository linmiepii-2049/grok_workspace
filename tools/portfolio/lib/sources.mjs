// 外部資料來源：FinMind（報價、匯率、台股新聞）、Finnhub（美股新聞、財報日）、
// 證交所（除息）、聯準會（FOMC）、FRED（總經公布日）、Google News RSS（台股大盤新聞）
// 金鑰都從環境變數讀；沒有金鑰的來源由呼叫端跳過
import { isTW, twCode } from "./ledger.mjs";

const UA = "jteam-portfolio/1.0 (personal portfolio tracker)";

async function get(url, { headers = {}, as = "json", tries = 3 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}：${(await res.text()).slice(0, 200)}`), { fatal: true });
      return as === "json" ? await res.json() : await res.text();
    } catch (e) {
      last = e;
      if (e.fatal) break;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`${new URL(url).host} 失敗：${last.message}`);
}

// ---------- FinMind ----------

async function finmind(dataset, params = {}) {
  const url = new URL("https://api.finmindtrade.com/api/v4/data");
  url.search = new URLSearchParams({ dataset, ...params });
  const headers = process.env.FINMIND_TOKEN ? { authorization: `Bearer ${process.env.FINMIND_TOKEN}` } : {};
  const body = await get(url, { headers });
  if (body.status !== 200) throw new Error(`FinMind ${dataset}：${body.msg}`);
  return body.data;
}

// { [date]: close }，原幣
export async function fetchCloses(symbol, start) {
  if (isTW(symbol)) {
    const rows = await finmind("TaiwanStockPrice", { data_id: twCode(symbol), start_date: start });
    return Object.fromEntries(rows.filter((r) => r.close > 0).map((r) => [r.date, r.close]));
  }
  const rows = await finmind("USStockPrice", { data_id: symbol, start_date: start });
  return Object.fromEntries(rows.filter((r) => r.Close > 0).map((r) => [r.date, r.Close]));
}

// 台銀美元即期買賣中價：{ [date]: rate }
export async function fetchUsdTwd(start) {
  const rows = await finmind("TaiwanExchangeRate", { data_id: "USD", start_date: start });
  return Object.fromEntries(
    rows.filter((r) => r.spot_buy > 0 && r.spot_sell > 0).map((r) => [r.date, Math.round(((r.spot_buy + r.spot_sell) / 2) * 1e4) / 1e4]),
  );
}

export async function fetchNames(symbols) {
  const names = {};
  const tw = symbols.filter(isTW);
  const us = symbols.filter((s) => !isTW(s));
  if (tw.length) {
    const rows = await finmind("TaiwanStockInfo");
    // FinMind 會在部分名稱後加 *，顯示時去掉
    for (const s of tw) names[s] = rows.find((r) => r.stock_id === twCode(s))?.stock_name?.replace(/\*+$/, "") ?? s;
  }
  if (us.length) {
    const rows = await finmind("USStockInfo");
    for (const s of us) {
      // 「NVIDIA Corporation Common Stock」→「NVIDIA」：反覆去掉公司型態與股份類別尾綴
      const full = rows.find((r) => r.stock_id === s)?.stock_name;
      let short = full ?? s;
      for (let prev = ""; prev !== short; ) {
        prev = short;
        short = short.replace(/[\s,]+(Common Stock|Class [A-C]\b.*|Ordinary Shares.*|American Depositary Shares.*|Inc\.?|Corporation|Corp\.?|and Company|Company|Co\.?|Group|Holdings|Ltd\.?|A\/S|plc|N\.V\.|S\.A\.)$/i, "").trim();
      }
      names[s] = short || full || s;
    }
  }
  return names;
}

// 台股個股新聞；FinMind 一次只給一天
export async function fetchTWNews(symbol, days) {
  const out = [];
  for (const day of days) {
    const rows = await finmind("TaiwanStockNews", { data_id: twCode(symbol), start_date: day });
    for (const r of rows)
      out.push({
        symbol, url: r.link, title: r.title.replace(/\s+-\s+[^-]+$/, ""), source: r.source,
        published_at: new Date(`${r.date.replace(" ", "T")}+08:00`).toISOString(),
      });
  }
  return out;
}

// ---------- Finnhub（美股）----------

const finnhub = (path, params) => {
  const url = new URL(`https://finnhub.io/api/v1/${path}`);
  url.search = new URLSearchParams({ ...params, token: process.env.FINNHUB_API_KEY });
  return get(url);
};

export async function fetchUSNews(symbol, from, to) {
  const rows = await finnhub("company-news", { symbol, from, to });
  return rows.map((r) => ({
    symbol, url: r.url, title: r.headline, source: r.source, summary: r.summary || null,
    published_at: new Date(r.datetime * 1000).toISOString(),
  }));
}

export async function fetchUSMarketNews() {
  const rows = await finnhub("news", { category: "general" });
  return rows.map((r) => ({
    symbol: "*", url: r.url, title: r.headline, source: r.source, summary: r.summary || null,
    published_at: new Date(r.datetime * 1000).toISOString(),
  }));
}

const EARNINGS_HOUR = { bmo: "盤前", amc: "盤後", dmh: "盤中" };

export async function fetchEarnings(symbol, from, to, names) {
  const { earningsCalendar = [] } = await finnhub("calendar/earnings", { symbol, from, to });
  return earningsCalendar.map((e) => ({
    date: e.date, kind: "earnings", symbol,
    title: `${names[symbol] ?? symbol} 財報（${e.year} Q${e.quarter}）`,
    detail: [EARNINGS_HOUR[e.hour], e.epsEstimate != null ? `預估 EPS ${e.epsEstimate}` : null].filter(Boolean).join(" · ") || null,
  }));
}

// ---------- 證交所：除權息預告 ----------

// 民國日期 1151106 → 2026-11-06
const rocDate = (s) => `${Number(s.slice(0, 3)) + 1911}-${s.slice(3, 5)}-${s.slice(5, 7)}`;

export async function fetchTWExDividends(symbols, names) {
  const rows = await get("https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL");
  const codes = new Map(symbols.filter(isTW).map((s) => [twCode(s), s]));
  return rows
    .filter((r) => codes.has(r.Code))
    .map((r) => {
      const symbol = codes.get(r.Code);
      const cash = Number(r.CashDividend);
      return {
        date: rocDate(r.Date), kind: "exdiv", symbol,
        title: `${names[symbol] ?? r.Name} 除${r.Exdividend}`,
        detail: cash > 0 ? `現金股利 ${cash} 元` : r.StockDividendRatio ? `配股比率 ${r.StockDividendRatio}` : null,
      };
    });
}

// ---------- 總經 ----------

const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };

// 聯準會 FOMC 行事曆；決議在會議第二天美東 14:00 公布（台北隔日凌晨）
export async function fetchFomc(years) {
  const html = await get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", { as: "text" });
  const events = [];
  for (const year of years) {
    const start = html.indexOf(`${year} FOMC Meetings`);
    if (start < 0) continue;
    const next = html.indexOf(`${year - 1} FOMC Meetings`, start);
    const section = html.slice(start, next > 0 ? next : start + 20000);
    for (const m of section.matchAll(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g)) {
      // 月份可能跨月，例如「April/May」「30-1」：決議日取最後一個月份與最後一天
      const month = MONTHS[m[1].trim().split("/").pop()];
      const day = Number(m[2].replace(/[^\d-]/g, "").split("-").pop());
      if (!month || !day) continue;
      events.push({
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, kind: "macro", symbol: "",
        title: "FOMC 利率決議",
        detail: `美東 14:00 公布（台北隔日凌晨）${m[2].includes("*") ? " · 含經濟預測與點陣圖" : ""}`,
      });
    }
  }
  return events;
}

// FRED 的 release id；name 用來確認 id 沒有對錯
const FRED_RELEASES = [
  { id: 10, name: "Consumer Price Index", title: "CPI 消費者物價指數" },
  { id: 50, name: "Employment Situation", title: "非農就業報告" },
  { id: 46, name: "Producer Price Index", title: "PPI 生產者物價指數" },
  { id: 53, name: "Gross Domestic Product", title: "GDP 國內生產毛額" },
  { id: 54, name: "Personal Income and Outlays", title: "PCE 個人所得與支出" },
  { id: 9, name: "Advance Monthly Sales for Retail", title: "零售銷售" },
];

export async function fetchFredReleases(from, to) {
  const fred = (path, params) => {
    const url = new URL(`https://api.stlouisfed.org/fred/${path}`);
    url.search = new URLSearchParams({ ...params, api_key: process.env.FRED_API_KEY, file_type: "json" });
    return get(url);
  };
  const events = [];
  for (const r of FRED_RELEASES) {
    const info = await fred("release", { release_id: r.id });
    if (!info.releases?.[0]?.name?.startsWith(r.name)) {
      console.warn(`⚠ FRED release ${r.id} 的名稱是「${info.releases?.[0]?.name}」，不是 ${r.name}，略過`);
      continue;
    }
    const { release_dates = [] } = await fred("release/dates", {
      release_id: r.id, realtime_start: from, realtime_end: "9999-12-31",
      include_release_dates_with_no_data: "true", sort_order: "asc", limit: "20",
    });
    for (const d of release_dates)
      if (d.date >= from && d.date <= to)
        events.push({ date: d.date, kind: "macro", symbol: "", title: r.title, detail: "美東 08:30 公布（台北晚間）" });
  }
  return events;
}

// 台股每月 10 日前公布上月營收
export function twRevenueDeadlines(from, to) {
  const events = [];
  const d = new Date(`${from.slice(0, 7)}-10T00:00:00Z`);
  for (let i = 0; i < 4; i++, d.setUTCMonth(d.getUTCMonth() + 1)) {
    const date = d.toISOString().slice(0, 10);
    if (date >= from && date <= to)
      events.push({ date, kind: "revenue", symbol: "", title: "台股月營收公布截止", detail: "上市櫃公司須在每月 10 日前公布上月營收" });
  }
  return events;
}

// ---------- Google News RSS（台股大盤）----------

const decode = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]);

export async function fetchGoogleNews(query, symbol = "*") {
  const url = new URL("https://news.google.com/rss/search");
  url.search = new URLSearchParams({ q: `${query} when:1d`, hl: "zh-TW", gl: "TW", ceid: "TW:zh-Hant" });
  const xml = await get(url, { as: "text" });
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const tag = (t) => decode(item.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "").trim();
    const source = tag("source");
    return {
      symbol, url: tag("link"), title: tag("title").replace(` - ${source}`, ""), source,
      published_at: new Date(tag("pubDate")).toISOString(),
    };
  });
}

