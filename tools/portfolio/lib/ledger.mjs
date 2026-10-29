// 讀取 ledger.yaml，依時間重播每筆交易，算出每天的資產快照與已實現損益
// 金額一律換算台幣；成本用平均成本法（和台灣券商 App 一致）
// 未實現損益扣掉今天全部賣出的預估手續費與證交稅，和券商的「參考損益」一致
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const TYPES = ["buy", "sell", "dividend", "stock_dividend", "interest", "deposit", "withdraw"];
const REQUIRED = {
  buy: ["symbol", "account", "shares", "price"],
  sell: ["symbol", "account", "shares", "price"],
  dividend: ["symbol", "account", "amount"],
  stock_dividend: ["symbol", "account", "shares"],
  interest: ["account", "amount"],
  deposit: ["account", "amount"],
  withdraw: ["account", "amount"],
};

export const isTW = (symbol) => /\.(TW|TWO)$/.test(symbol);
export const currencyOf = (symbol) => (isTW(symbol) ? "TWD" : "USD");
export const twCode = (symbol) => symbol.replace(/\.(TW|TWO)$/, "");
// 台股 ETF 代號 00 開頭，證交稅 0.1%
const isTWEtf = (symbol) => isTW(symbol) && twCode(symbol).startsWith("00");

const round2 = (n) => Math.round(n * 100) / 100;
const toDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));

class LedgerError extends Error {}

export function loadLedger(file) {
  let doc;
  try {
    // 日期維持字串，避免 YAML 把 2026-10-29 轉成 UTC 時間
    doc = parse(readFileSync(file, "utf8"), { schema: "core" });
  } catch (e) {
    throw new LedgerError(`ledger.yaml 格式錯誤：${e.message}`);
  }
  return validateLedger(doc ?? {});
}

export function validateLedger(doc) {
  const errors = [];
  const where = (section, i) => `${section} 第 ${i + 1} 筆`;
  const num = (v) => typeof v === "number" && Number.isFinite(v);

  const opening = toDate(doc.opening_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opening)) errors.push("opening_date 要寫成 YYYY-MM-DD");

  const accounts = new Map();
  (doc.accounts ?? []).forEach((a, i) => {
    if (!a?.name) return errors.push(`${where("accounts", i)}：缺少 name`);
    if (!["TWD", "USD"].includes(a.currency)) errors.push(`${where("accounts", i)}：currency 只能是 TWD 或 USD`);
    if (a.cash != null && !num(a.cash)) errors.push(`${where("accounts", i)}：cash 要是數字`);
    if (accounts.has(a.name)) errors.push(`${where("accounts", i)}：帳戶「${a.name}」重複`);
    accounts.set(a.name, { name: a.name, currency: a.currency, cash: a.cash ?? 0 });
  });
  if (!accounts.size) errors.push("accounts 至少要有一個帳戶");
  const checkAccount = (name, label) => {
    if (!accounts.has(name)) errors.push(`${label}：帳戶「${name}」不在 accounts 裡`);
  };

  const positions = (doc.opening_positions ?? []).map((p, i) => {
    const label = where("opening_positions", i);
    for (const k of ["symbol", "account", "shares", "avg_cost"]) if (p?.[k] == null) errors.push(`${label}：缺少 ${k}`);
    if (p?.shares != null && !(num(p.shares) && p.shares > 0)) errors.push(`${label}：shares 要是正數`);
    if (p?.avg_cost != null && !num(p.avg_cost)) errors.push(`${label}：avg_cost 要是數字`);
    if (p?.cost_fx != null && !num(p.cost_fx)) errors.push(`${label}：cost_fx 要是數字`);
    if (p?.account) checkAccount(p.account, label);
    return { ...p, symbol: String(p?.symbol ?? "").toUpperCase() };
  });

  const transactions = (doc.transactions ?? []).map((t, i) => {
    const label = where("transactions", i);
    const date = toDate(t?.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`${label}：date 要寫成 YYYY-MM-DD`);
    else if (date < opening) errors.push(`${label}：日期早於 opening_date，請改寫進 opening_positions`);
    if (!TYPES.includes(t?.type)) {
      errors.push(`${label}：type 只能是 ${TYPES.join("、")}`);
      return { ...t, date };
    }
    for (const k of REQUIRED[t.type]) if (t[k] == null) errors.push(`${label}：${t.type} 需要 ${k}`);
    for (const k of ["shares", "price", "amount", "fee", "tax", "fx"])
      if (t[k] != null && !(num(t[k]) && t[k] >= 0)) errors.push(`${label}：${k} 要是非負數字`);
    if (t.account) checkAccount(t.account, label);
    return { ...t, date, symbol: t.symbol ? String(t.symbol).toUpperCase() : undefined, index: i };
  });

  if (errors.length) throw new LedgerError(`ledger.yaml 有 ${errors.length} 個問題：\n  - ${errors.join("\n  - ")}`);
  // 同一天的交易依檔案順序執行
  transactions.sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
  return { opening, accounts: [...accounts.values()], positions, transactions };
}

// 帳本裡出現過的所有股票
export const symbolsOf = (ledger) =>
  [...new Set([...ledger.positions.map((p) => p.symbol), ...ledger.transactions.map((t) => t.symbol).filter(Boolean)])].sort();

// 台股牌告手續費 0.1425%，最低 20 元；美股多數券商零手續費
const defaultFee = (symbol, gross) => (isTW(symbol) ? Math.max(20, Math.floor(gross * 0.001425)) : 0);
const defaultSellTax = (symbol, gross) => (isTW(symbol) ? Math.floor(gross * (isTWEtf(symbol) ? 0.001 : 0.003)) : 0);

// 依日期取「當天或之前最近一筆」的值：休市日沿用前一個交易日收盤
export function seriesLookup(series) {
  const dates = Object.keys(series).sort();
  return (date) => {
    let lo = 0;
    let hi = dates.length - 1;
    let found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= date) {
        found = dates[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found ? series[found] : null;
  };
}

/**
 * 從起始日重播到最後一個交易日
 * @param ledger    validateLedger 的結果
 * @param prices    { [symbol]: { [date]: close } }，原幣
 * @param fx        { [date]: 美元兌台幣 }
 * @param dates     要產生快照的日期（交易日），已排序
 * @param bench     { [symbol]: { [date]: close } } 比較基準
 * @param names     { [symbol]: 名稱 }
 */
export function computeSnapshots({ ledger, prices, fx, dates, bench = {}, names = {} }) {
  const fxAt = seriesLookup(fx);
  const priceAt = Object.fromEntries(Object.entries(prices).map(([s, ser]) => [s, seriesLookup(ser)]));
  const benchAt = Object.fromEntries(Object.entries(bench).map(([s, ser]) => [s, seriesLookup(ser)]));
  const rate = (cur, date, override) => (cur === "TWD" ? 1 : (override ?? fxAt(date)));
  const needRate = (date) => {
    const r = fxAt(date);
    if (!r) throw new LedgerError(`找不到 ${date} 的美元匯率`);
    return r;
  };

  const accounts = new Map(ledger.accounts.map((a) => [a.name, { ...a }]));
  const holdings = new Map(); // `${account}|${symbol}` → { symbol, account, shares, costNative, costTwd }
  const key = (a, s) => `${a}|${s}`;

  for (const p of ledger.positions) {
    const cur = currencyOf(p.symbol);
    const costNative = p.shares * p.avg_cost;
    const r = cur === "TWD" ? 1 : (p.cost_fx ?? needRate(ledger.opening));
    const h = holdings.get(key(p.account, p.symbol)) ?? { symbol: p.symbol, account: p.account, shares: 0, costNative: 0, costTwd: 0 };
    h.shares += p.shares;
    h.costNative += costNative;
    h.costTwd += costNative * r;
    holdings.set(key(p.account, p.symbol), h);
  }

  // 把交易幣別的金額記到帳戶現金（帳戶幣別不同時用當天匯率換算，例如台幣交割的複委託）
  const moveCash = (account, amount, cur, date, fxOverride) => {
    const acct = accounts.get(account);
    if (acct.currency === cur) acct.cash += amount;
    else {
      const usdTwd = fxOverride ?? needRate(date);
      acct.cash += cur === "USD" ? amount * usdTwd : amount / usdTwd;
    }
  };

  const realized = [];
  let realizedCum = 0;
  let incomeCum = 0;
  let txIdx = 0;
  let prev = null;
  let twrIndex = 1;
  const benchBase = {};
  const snapshots = [];

  for (const date of dates) {
    if (date < ledger.opening) continue;
    let netFlow = 0;

    for (; txIdx < ledger.transactions.length && ledger.transactions[txIdx].date <= date; txIdx++) {
      const t = ledger.transactions[txIdx];
      const where = `${t.date} ${t.type} ${t.symbol ?? t.account}`;
      if (t.type === "deposit" || t.type === "withdraw") {
        const acct = accounts.get(t.account);
        const sign = t.type === "deposit" ? 1 : -1;
        acct.cash += sign * t.amount;
        netFlow += sign * t.amount * rate(acct.currency, t.date, t.fx);
        continue;
      }
      if (t.type === "interest") {
        const acct = accounts.get(t.account);
        acct.cash += t.amount;
        incomeCum += t.amount * rate(acct.currency, t.date, t.fx);
        continue;
      }

      const cur = currencyOf(t.symbol);
      const r = rate(cur, t.date, t.fx);
      const k = key(t.account, t.symbol);
      const h = holdings.get(k) ?? { symbol: t.symbol, account: t.account, shares: 0, costNative: 0, costTwd: 0 };

      if (t.type === "buy") {
        const gross = t.shares * t.price;
        const fee = t.fee ?? defaultFee(t.symbol, gross);
        h.shares += t.shares;
        h.costNative += gross + fee;
        h.costTwd += (gross + fee) * r;
        holdings.set(k, h);
        moveCash(t.account, -(gross + fee), cur, t.date, t.fx);
      } else if (t.type === "sell") {
        if (t.shares > h.shares + 1e-9) throw new LedgerError(`${where}：賣出 ${t.shares} 股，但「${t.account}」只持有 ${h.shares} 股`);
        const gross = t.shares * t.price;
        const fee = t.fee ?? defaultFee(t.symbol, gross);
        const tax = t.tax ?? defaultSellTax(t.symbol, gross);
        const net = gross - fee - tax;
        const ratio = t.shares / h.shares;
        const costNative = h.costNative * ratio;
        const costTwd = h.costTwd * ratio;
        const proceeds = net * r;
        const pnl = proceeds - costTwd;
        const pnlPrice = (net - costNative) * r;
        realized.push({
          date: t.date, symbol: t.symbol, account: t.account, shares: t.shares,
          proceeds: round2(proceeds), cost: round2(costTwd), pnl: round2(pnl), pnl_price: round2(pnlPrice), pnl_fx: round2(pnl - pnlPrice),
        });
        realizedCum += pnl;
        h.shares -= t.shares;
        h.costNative -= costNative;
        h.costTwd -= costTwd;
        if (h.shares < 1e-9) holdings.delete(k);
        moveCash(t.account, net, cur, t.date, t.fx);
      } else if (t.type === "dividend") {
        const net = t.amount - (t.tax ?? 0);
        incomeCum += net * r;
        moveCash(t.account, net, cur, t.date, t.fx);
      } else if (t.type === "stock_dividend") {
        if (!holdings.has(k)) throw new LedgerError(`${where}：配股前「${t.account}」沒有持有 ${t.symbol}`);
        h.shares += t.shares;
      }
    }

    const usd = needRate(date);
    let marketValue = 0;
    let cost = 0;
    let unrealizedSum = 0;
    const positions = [];
    for (const h of holdings.values()) {
      const close = priceAt[h.symbol]?.(date);
      if (close == null) throw new LedgerError(`找不到 ${h.symbol} 在 ${date} 以前的收盤價，代號是否正確？`);
      const cur = currencyOf(h.symbol);
      const r = cur === "TWD" ? 1 : usd;
      const mvNative = h.shares * close;
      const mv = mvNative * r;
      const sellCost = defaultFee(h.symbol, mvNative) + defaultSellTax(h.symbol, mvNative);
      const unrealized = mv - sellCost * r - h.costTwd;
      const unrealPrice = (mvNative - sellCost - h.costNative) * r;
      const prevClose = prev?.closes[h.symbol];
      marketValue += mv;
      cost += h.costTwd;
      unrealizedSum += unrealized;
      positions.push({
        symbol: h.symbol, name: names[h.symbol] ?? h.symbol, account: h.account, currency: cur,
        shares: h.shares, close, prev_close: prevClose ?? null,
        avg_cost: round2(h.costNative / h.shares), market_value: round2(mv), cost: round2(h.costTwd),
        sell_cost: sellCost, unrealized: round2(unrealized), unreal_price: round2(unrealPrice), unreal_fx: round2(unrealized - unrealPrice),
      });
    }

    const cashByCcy = { TWD: 0, USD: 0 };
    for (const a of accounts.values()) cashByCcy[a.currency] += a.cash;
    const cash = cashByCcy.TWD + cashByCcy.USD * usd;
    const total = marketValue + cash;
    // 時間加權報酬：當天的入金出金視為發生在收盤前，不算進報酬
    if (prev && prev.total > 0) twrIndex *= (total - netFlow) / prev.total;
    for (const p of positions) p.weight = total ? round2((p.market_value / total) * 10000) / 10000 : 0;
    positions.sort((a, b) => b.market_value - a.market_value);

    const benchRet = {};
    for (const [s, at] of Object.entries(benchAt)) {
      const close = at(date);
      if (close == null) continue;
      const twd = close * (currencyOf(s) === "TWD" ? 1 : usd);
      benchBase[s] ??= twd;
      benchRet[s] = Math.round((twd / benchBase[s] - 1) * 1e6) / 1e6;
    }

    const snap = {
      date, total: round2(total), market_value: round2(marketValue), cash: round2(cash), cost: round2(cost),
      unrealized: round2(unrealizedSum), realized_cum: round2(realizedCum), income_cum: round2(incomeCum),
      cash_by_ccy: { TWD: round2(cashByCcy.TWD), USD: round2(cashByCcy.USD) },
      net_flow: round2(netFlow), twr: Math.round((twrIndex - 1) * 1e6) / 1e6, bench: benchRet, positions, fx_usd: usd,
    };
    snapshots.push(snap);
    prev = { total, closes: Object.fromEntries(positions.map((p) => [p.symbol, p.close])) };
  }

  const pending = ledger.transactions.slice(txIdx);
  return { snapshots, realized, pending };
}

export { LedgerError };
