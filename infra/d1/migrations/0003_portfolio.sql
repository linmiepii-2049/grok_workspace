-- 投資追蹤（tools/portfolio）：金額一律台幣，日期一律台北時間 YYYY-MM-DD
-- pf_snapshots、pf_realized 每次從 ledger.yaml 全部重算後取代；其餘表累積保留

-- 每天一筆資產快照；positions 是當天各持股明細
CREATE TABLE pf_snapshots (
  date          TEXT PRIMARY KEY,
  total         REAL NOT NULL,                      -- 總資產 = 市值 + 現金
  market_value  REAL NOT NULL,
  cash          REAL NOT NULL,
  cash_by_ccy   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cash_by_ccy)),  -- 各幣別現金原幣金額 {"TWD": 0, "USD": 0}
  cost          REAL NOT NULL,                      -- 持股成本
  unrealized    REAL NOT NULL,
  realized_cum  REAL NOT NULL,                      -- 起始日至今累積已實現損益
  income_cum    REAL NOT NULL,                      -- 起始日至今累積股利 + 利息（稅後）
  net_flow      REAL NOT NULL,                      -- 當天入金 - 出金
  twr           REAL NOT NULL,                      -- 起始日至今時間加權報酬率，0.05 = 5%
  bench         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(bench)),     -- {"0050.TW": 0.03, "VOO": 0.02} 同期報酬
  positions     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(positions)),
  fx_usd        REAL NOT NULL
);

-- 每筆賣出的已實現損益；美股拆成股價與匯率兩部分
CREATE TABLE pf_realized (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  account     TEXT NOT NULL,
  shares      REAL NOT NULL,
  proceeds    REAL NOT NULL,                        -- 扣除費用與稅後的賣出金額
  cost        REAL NOT NULL,
  pnl         REAL NOT NULL,
  pnl_price   REAL NOT NULL,
  pnl_fx      REAL NOT NULL
);

CREATE INDEX idx_pf_realized_date ON pf_realized (date DESC);

-- 行事曆：財報、除息、總經公布日
CREATE TABLE pf_events (
  date        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('earnings', 'exdiv', 'macro', 'revenue')),
  symbol      TEXT NOT NULL DEFAULT '',             -- 總經事件為空字串，才能放進 PRIMARY KEY
  title       TEXT NOT NULL,
  detail      TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (date, kind, symbol, title)
);

CREATE INDEX idx_pf_events_symbol ON pf_events (symbol, date);

CREATE TABLE pf_news (
  url           TEXT PRIMARY KEY,
  symbol        TEXT NOT NULL,                      -- 大盤新聞為 '*'
  title         TEXT NOT NULL,
  source        TEXT,
  summary       TEXT,
  published_at  TEXT NOT NULL                       -- UTC ISO 8601
);

CREATE INDEX idx_pf_news_symbol ON pf_news (symbol, published_at DESC);
CREATE INDEX idx_pf_news_time   ON pf_news (published_at DESC);

-- 每日持股晨報
CREATE TABLE pf_briefs (
  date        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,                        -- Markdown，連結只會指向 pf_news 收錄的網址
  model       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
