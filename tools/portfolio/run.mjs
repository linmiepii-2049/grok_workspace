#!/usr/bin/env node
// 投資追蹤排程：node tools/portfolio/run.mjs <snapshot|events|brief>... [--local] [--dry-run]
//   snapshot  從 ledger.yaml 重算起始日至今每天的資產、損益、TWR，取代 D1 裡的舊資料
//   events    抓未來 60 天的財報、除息、總經公布日
//   brief     抓新聞、請 Claude 寫晨報，寫進 D1 與 outputs/briefs/<日期>.md（會先跑 snapshot）
//             今天已經有晨報就不重寫（Worker 與 GitHub cron 都會觸發），--force 強制重寫
//   不論指定哪個，都會先跑 snapshot（其他任務需要最新持股）
//   --local   寫進 jteam-viewer 的本機 D1；--dry-run 只印出 SQL；--force 重寫今天的晨報；--ledger=<路徑> 改用其他帳本（測試用）
// 金鑰（環境變數，缺少時跳過該來源）：FINNHUB_API_KEY、FRED_API_KEY、ANTHROPIC_API_KEY；FINMIND_TOKEN 選填
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execute, insert, query } from "./lib/d1.mjs";
import { computeSnapshots, isTW, LedgerError, loadLedger, symbolsOf } from "./lib/ledger.mjs";
import * as src from "./lib/sources.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const PROJECT = join(ROOT, "projects/2026-10-portfolio");
const BENCHMARKS = ["0050.TW", "VOO"];
const EVENT_DAYS = 60;
const NEWS_PER_SYMBOL = 8;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const ledgerPath = args.find((a) => a.startsWith("--ledger="))?.slice(9) ?? join(PROJECT, "ledger.yaml");
const tasks = new Set(args.filter((a) => !a.startsWith("--")));
if (!tasks.size || [...tasks].some((t) => !["snapshot", "events", "brief"].includes(t))) {
  console.error("用法：node tools/portfolio/run.mjs <snapshot|events|brief>... [--local] [--dry-run] [--force]");
  process.exit(1);
}
const opts = { local: flags.has("--local"), dryRun: flags.has("--dry-run") };

const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `⚠ ${msg}`);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // 台北日期

// ---------- snapshot ----------

async function snapshot() {
  const ledger = loadLedger(ledgerPath);
  const symbols = symbolsOf(ledger);
  const start = addDays(ledger.opening, -14); // 起始日若休市，往前找最近的收盤價與匯率

  const prices = {};
  for (const s of [...new Set([...symbols, ...BENCHMARKS])]) prices[s] = await src.fetchCloses(s, start);
  const fx = await src.fetchUsdTwd(start);
  const names = await src.fetchNames([...new Set([...symbols, ...BENCHMARKS])]);

  // 台股或美股任一邊有開盤的日子都產生快照；美股日期是美東交易日
  const dates = [...new Set(BENCHMARKS.flatMap((b) => Object.keys(prices[b])))]
    .filter((d) => d >= ledger.opening && d <= today)
    .sort();
  if (!dates.length) {
    warn(`起始日 ${ledger.opening} 之後還沒有收盤資料，晚點再跑`);
    return { ledger, names, snapshots: [] };
  }

  const bench = Object.fromEntries(BENCHMARKS.map((b) => [b, prices[b]]));
  const { snapshots, realized, pending } = computeSnapshots({ ledger, prices, fx, dates, bench, names });
  if (pending.length) console.log(`  ${pending.length} 筆交易日期在最新收盤之後，下次更新時計入`);

  execute(
    [
      "DELETE FROM pf_snapshots;",
      "DELETE FROM pf_realized;",
      ...snapshots.map((s) => insert("pf_snapshots", s)),
      ...realized.map((r) => insert("pf_realized", r)),
    ],
    opts,
  );
  const last = snapshots.at(-1);
  console.log(`✔ snapshot：${snapshots.length} 天，${last.date} 總資產 ${Math.round(last.total).toLocaleString()} 元，TWR ${(last.twr * 100).toFixed(2)}%`);
  return { ledger, names, snapshots };
}

// ---------- events ----------

async function events(ctx) {
  const symbols = ctx.snapshots.at(-1)?.positions.map((p) => p.symbol) ?? symbolsOf(ctx.ledger);
  const to = addDays(today, EVENT_DAYS);
  const groups = []; // [kind 條件, 事件]：只有抓成功的種類才取代舊資料

  const attempt = async (label, kinds, fn) => {
    try {
      groups.push({ kinds, rows: await fn() });
    } catch (e) {
      warn(`${label} 失敗，沿用舊資料：${e.message}`);
    }
  };

  const us = symbols.filter((s) => !isTW(s));
  if (us.length && process.env.FINNHUB_API_KEY)
    await attempt("美股財報日", { kind: "earnings", symbols: us }, async () => {
      const rows = [];
      for (const s of us) rows.push(...(await src.fetchEarnings(s, today, to, ctx.names)));
      return rows;
    });
  else if (us.length) warn("沒有 FINNHUB_API_KEY，跳過美股財報日");

  const tw = symbols.filter(isTW);
  if (tw.length) {
    await attempt("台股除權息", { kind: "exdiv", symbols: tw }, () => src.fetchTWExDividends(tw, ctx.names));
    groups.push({ kinds: { kind: "revenue" }, rows: src.twRevenueDeadlines(today, to) });
  }

  const year = Number(today.slice(0, 4));
  await attempt("FOMC", { kind: "macro", title: "FOMC 利率決議" }, async () =>
    (await src.fetchFomc([year, year + 1])).filter((e) => e.date >= today && e.date <= to),
  );
  if (process.env.FRED_API_KEY) await attempt("FRED 總經公布日", { kind: "macro", notTitle: "FOMC 利率決議" }, () => src.fetchFredReleases(today, to));
  else warn("沒有 FRED_API_KEY，跳過 CPI、非農等公布日");

  const statements = [];
  for (const { kinds, rows } of groups) {
    const where = [`date >= '${today}'`, `kind = '${kinds.kind}'`];
    if (kinds.symbols) where.push(`symbol IN (${kinds.symbols.map((s) => `'${s.replace(/'/g, "''")}'`).join(", ")})`);
    if (kinds.title) where.push(`title = '${kinds.title}'`);
    if (kinds.notTitle) where.push(`title <> '${kinds.notTitle}'`);
    statements.push(`DELETE FROM pf_events WHERE ${where.join(" AND ")};`);
    statements.push(...rows.map((r) => insert("pf_events", r, { conflict: "OR REPLACE" })));
  }
  execute(statements, opts);
  const all = groups.flatMap((g) => g.rows).sort((a, b) => a.date.localeCompare(b.date));
  console.log(`✔ events：${all.length} 筆`);
  return all;
}

// ---------- brief ----------

async function collectNews(ctx) {
  const latest = ctx.snapshots.at(-1);
  const since = Date.now() - 30 * 3600_000;
  const news = [];
  const add = (rows) => news.push(...rows.filter((n) => n.url && n.title && Date.parse(n.published_at) >= since)
    .sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, NEWS_PER_SYMBOL));
  const tryAdd = async (label, fn) => {
    try {
      add(await fn());
    } catch (e) {
      warn(`${label} 新聞失敗：${e.message}`);
    }
  };

  const yesterday = addDays(today, -1);
  for (const p of latest.positions) {
    if (isTW(p.symbol)) await tryAdd(p.symbol, () => src.fetchTWNews(p.symbol, [yesterday, today]));
    else if (process.env.FINNHUB_API_KEY) await tryAdd(p.symbol, () => src.fetchUSNews(p.symbol, yesterday, today));
  }
  await tryAdd("台股大盤", () => src.fetchGoogleNews("台股 加權指數"));
  if (process.env.FINNHUB_API_KEY) await tryAdd("美股大盤", () => src.fetchUSMarketNews());
  else warn("沒有 FINNHUB_API_KEY，跳過美股新聞");

  // 同一則新聞可能同時出現在多檔持股，留第一筆
  const seen = new Set();
  return news.filter((n) => !seen.has(n.url) && seen.add(n.url));
}

async function brief(ctx, upcoming) {
  const latest = ctx.snapshots.at(-1);
  if (!latest) return;
  const news = await collectNews(ctx);
  execute(news.map((n) => insert("pf_news", { summary: null, ...n }, { conflict: "OR IGNORE" })), opts);
  console.log(`✔ news：${news.length} 則`);

  if (!process.env.ANTHROPIC_API_KEY) {
    warn("沒有 ANTHROPIC_API_KEY，跳過晨報");
    return;
  }
  if (!flags.has("--force") && !opts.dryRun && query(`SELECT 1 FROM pf_briefs WHERE date = '${today}'`, opts).length) {
    console.log(`✔ brief：${today} 已經有晨報，不重寫（--force 強制重寫）`);
    return;
  }
  const { writeBrief } = await import("./lib/brief.mjs");
  const events = (upcoming ?? []).filter((e) => e.date <= addDays(today, 7));
  const result = await writeBrief({ today, latest, previous: ctx.snapshots.at(-2), news, events, names: ctx.names });
  execute([insert("pf_briefs", { date: today, title: result.title, body: result.body, model: result.model }, { conflict: "OR REPLACE" })], opts);

  const file = join(PROJECT, "outputs/briefs", `${today}.md`);
  if (!opts.dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, result.body + "\n");
  }
  console.log(`✔ brief：${result.title}（輸入 ${result.usage.input_tokens}、輸出 ${result.usage.output_tokens} tokens）`);
}

// ---------- main ----------

try {
  const ctx = await snapshot();
  const upcoming = tasks.has("events") || tasks.has("brief") ? await events(ctx) : null;
  if (tasks.has("brief")) await brief(ctx, upcoming);
} catch (e) {
  if (e instanceof LedgerError) {
    console.error(process.env.GITHUB_ACTIONS ? `::error::${e.message.replace(/\n/g, "%0A")}` : `✘ ${e.message}`);
    process.exit(1);
  }
  throw e;
}
