// node --test tools/portfolio/
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSnapshots, validateLedger } from "./lib/ledger.mjs";

const base = (transactions = [], extra = {}) =>
  validateLedger({
    opening_date: "2026-10-01",
    accounts: [
      { name: "台股", currency: "TWD", cash: 100000 },
      { name: "美股", currency: "USD", cash: 1000 },
    ],
    opening_positions: [{ symbol: "2330.TW", account: "台股", shares: 1000, avg_cost: 100 }],
    transactions,
    ...extra,
  });

const prices = { "2330.TW": { "2026-10-01": 100, "2026-10-02": 110, "2026-10-03": 121 }, NVDA: { "2026-10-01": 100, "2026-10-02": 100, "2026-10-03": 100 } };
const fx = { "2026-10-01": 30, "2026-10-02": 30, "2026-10-03": 33 };
const dates = ["2026-10-01", "2026-10-02", "2026-10-03"];
const run = (ledger) => computeSnapshots({ ledger, prices, fx, dates });

test("起始日總資產 = 市值 + 各幣別現金換算台幣", () => {
  const [first] = run(base()).snapshots;
  assert.equal(first.total, 100000 + 100000 + 1000 * 30);
  assert.equal(first.twr, 0);
});

test("入金不算報酬", () => {
  const { snapshots } = run(base([{ date: "2026-10-02", type: "deposit", account: "台股", amount: 500000 }]));
  // 2330 從 100 漲到 110：市值多 10000；總資產基礎 230000
  assert.equal(snapshots[1].net_flow, 500000);
  assert.ok(Math.abs(snapshots[1].twr - 10000 / 230000) < 1e-6);
});

test("台股賣出：預設手續費 0.1425%、證交稅 0.3%，平均成本法", () => {
  const { realized, snapshots } = run(base([{ date: "2026-10-02", type: "sell", symbol: "2330.TW", account: "台股", shares: 500, price: 110 }]));
  const gross = 55000;
  const fee = Math.floor(gross * 0.001425);
  const tax = Math.floor(gross * 0.003);
  assert.equal(realized[0].proceeds, gross - fee - tax);
  assert.equal(realized[0].cost, 50000);
  assert.equal(realized[0].pnl, gross - fee - tax - 50000);
  assert.equal(snapshots[1].positions[0].shares, 500);
  assert.equal(snapshots[1].cash, 100000 + gross - fee - tax + 30000);
});

test("美股損益拆成股價與匯率", () => {
  const { realized } = run(
    base([
      { date: "2026-10-01", type: "buy", symbol: "NVDA", account: "美股", shares: 10, price: 90 },
      { date: "2026-10-03", type: "sell", symbol: "NVDA", account: "美股", shares: 10, price: 100 },
    ]),
  );
  // 買 900 美元 @30 = 27000；賣 1000 美元 @33 = 33000
  assert.equal(realized[0].pnl, 6000);
  assert.equal(realized[0].pnl_price, 100 * 33);
  assert.equal(realized[0].pnl_fx, 6000 - 3300);
});

test("股利算收入、配股不改總成本", () => {
  const { snapshots } = run(
    base([
      { date: "2026-10-02", type: "dividend", symbol: "2330.TW", account: "台股", amount: 3000, tax: 100 },
      { date: "2026-10-02", type: "stock_dividend", symbol: "2330.TW", account: "台股", shares: 100 },
    ]),
  );
  assert.equal(snapshots[1].income_cum, 2900);
  assert.equal(snapshots[1].positions[0].shares, 1100);
  assert.equal(snapshots[1].positions[0].cost, 100000);
});

test("賣超過持股會報錯", () => {
  assert.throws(() => run(base([{ date: "2026-10-02", type: "sell", symbol: "2330.TW", account: "台股", shares: 2000, price: 110 }])), /只持有 1000 股/);
});

test("帳本錯誤一次列出", () => {
  assert.throws(
    () => base([{ date: "2026-09-01", type: "buy", symbol: "AAPL", account: "不存在", shares: -1 }]),
    (e) => /早於 opening_date/.test(e.message) && /不在 accounts/.test(e.message) && /需要 price/.test(e.message),
  );
});
