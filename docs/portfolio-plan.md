# 投資追蹤 — 實作計畫

> 狀態：已確認，實作中 · 2026-10-29

## 需求

- **市場**：台股、美股、ETF、現金，全部換算成台幣
- **持股輸入**：手動維護 `projects/2026-10-portfolio/ledger.yaml`（起始部位＋交易紀錄）
- **損益**：已實現、未實現、股利、匯率損益；報酬率用 TWR，並和 0050、VOO 比較
- **新聞**：每天產出一篇繁中「持股晨報」，每個重點附原文連結；用 Claude Haiku 撰寫
- **行事曆**：財報、除息、FOMC、CPI、非農等
- **歷史**：從 2026-10-29 開始記錄
- **推播**：先不做

## 架構

```
ledger.yaml（使用者維護）
    ↓ push main / 排程
GitHub Actions：portfolio.yml
 ├─ tools/portfolio/run.mjs snapshot   重算起始日至今每天的資產、損益、TWR → D1
 ├─ tools/portfolio/run.mjs events     抓財報、除息、總經日期 → D1
 └─ tools/portfolio/run.mjs brief      抓新聞 → Claude 寫晨報 → D1 + outputs/briefs/<日期>.md
    ↓
jteam-viewer：/portfolio（沿用 Cloudflare Access 登入）
```

**每次都從帳本重算全部歷史**，資料量很小（一天一筆）。好處：帳本補登或改錯時，歷史會自動跟著修正。

## 資料來源

| 資料                     | 來源                                                  | 金鑰                   |
| ------------------------ | ----------------------------------------------------- | ---------------------- |
| 台股、美股收盤價         | FinMind `TaiwanStockPrice`、`USStockPrice`            | 選填 `FINMIND_TOKEN`   |
| 美元匯率                 | FinMind `TaiwanExchangeRate`（台銀即期買賣中價）      | 同上                   |
| 台股新聞                 | FinMind `TaiwanStockNews`                             | 同上                   |
| 美股新聞、財報日         | Finnhub `company-news`、`calendar/earnings`（免費版） | `FINNHUB_API_KEY`      |
| 台股除息日               | 證交所 OpenAPI `TWT48U_ALL`                           | 不用                   |
| FOMC                     | 聯準會 FOMC 行事曆頁面                                | 不用                   |
| CPI、非農、PPI、GDP、PCE | FRED `release/dates`                                  | `FRED_API_KEY`（免費） |
| 晨報撰寫                 | Claude API（`claude-haiku-5-5`）                      | `ANTHROPIC_API_KEY`    |

- Yahoo Finance 會擋自動抓取，Stooq 有機器人驗證，所以都不用
- 缺少某個金鑰時，跳過該來源，不會讓整個排程失敗
- 台股上櫃的除息日、台股法說會日期：第一版先不做

## D1 資料表（`0003_portfolio.sql`）

| 表             | 內容                                              | 更新方式           |
| -------------- | ------------------------------------------------- | ------------------ |
| `pf_snapshots` | 每天一筆：總值、現金、成本、損益、TWR、各持股明細 | 每次全部重算後取代 |
| `pf_realized`  | 每筆賣出的已實現損益（股價／匯率拆開）            | 每次全部重算後取代 |
| `pf_events`    | 行事曆事件                                        | upsert             |
| `pf_news`      | 新聞（標題、來源、連結）                          | 依連結去重         |
| `pf_briefs`    | 每日晨報 Markdown                                 | 依日期 upsert      |

## 排程（台北時間）

| 時間             | 執行                                  |
| ---------------- | ------------------------------------- |
| 週一～五 16:00   | snapshot（台股收盤、FinMind 更新後）  |
| 週二～六 06:00   | snapshot＋events＋brief（美股收盤後） |
| 推上 ledger.yaml | snapshot                              |

## 網頁 `/portfolio`

- **總覽**：總資產、當日變化、累積報酬、資產走勢圖、TWR 和 0050／VOO 比較、資產配置
- **持股**：股數、成本、市值、未實現損益（美股拆股價和匯率）
- **已實現**：每筆賣出的損益、股利、利息
- **晨報**：每日文章列表
- **行事曆**：未來 30 天，可篩「只看持股」

## 不做 skill 的部分

每天的排程是 Actions 程式，不需要 skill。系統跑一兩週後，再決定要不要建 `portfolio` skill，用來在對話裡記帳、查新聞、看行事曆。

## 上線步驟

1. 使用者在 GitHub Secrets 加入 `FINNHUB_API_KEY`、`FRED_API_KEY`、`ANTHROPIC_API_KEY`（`FINMIND_TOKEN` 選填）
2. 合併 PR 後執行 `npm run db:migrate`，建立資料表
3. 使用者把 `ledger.yaml` 改成真實持股，推上 main
