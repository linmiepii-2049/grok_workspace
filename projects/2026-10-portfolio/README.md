# 投資追蹤

每天自動更新資產、損益與績效，整理持股新聞和重要日期，在 jteam-viewer 的 `/portfolio` 查看。方案見 [docs/portfolio-plan.md](../../docs/portfolio-plan.md)。

## 你要維護的只有 `ledger.yaml`

- **起始部位**：起始日以前就持有的股票，填股數和成本均價
- **交易**：之後每筆買賣、股利、入金出金，依時間往下加
- 推上 main 後會自動重算，不用手動跑任何指令
- 也可以在 Claude 對話裡說「記一筆：賣 NVDA 10 股 @ 205」，讓 Claude 幫你寫進去

### 欄位

| type             | 必填                                 | 選填         |
| ---------------- | ------------------------------------ | ------------ |
| `buy` / `sell`   | date, symbol, account, shares, price | fee, tax, fx |
| `dividend`       | date, symbol, account, amount        | tax          |
| `stock_dividend` | date, symbol, account, shares        |              |
| `interest`       | date, account, amount                |              |
| `deposit`        | date, account, amount                |              |
| `withdraw`       | date, account, amount                |              |

- 買賣的 `price`、`fee`、`tax` 和股利 `amount` 用**股票的幣別**（台股台幣、美股美元）；入金、出金、利息用**帳戶幣別**
- 帳戶幣別和股票不同時（例如台幣交割的複委託），現金會用當天匯率換算
- `fx` 是 1 美元兌台幣；不填就用當天收盤匯率
- 台股手續費不填時用牌告 0.1425%（最低 20 元）；有折扣的話請自己填 `fee`
- 台股證交稅不填時自動算：股票 0.3%、ETF（代號 00 開頭）0.1%

## 怎麼算

- **全部換算成台幣**，美股用當天匯率
- **已實現損益**：平均成本法，和台灣券商 App 一致；扣掉手續費和稅
- **未實現損益**：先扣掉今天全部賣出的預估手續費（0.1425%）和證交稅，和券商 App 的「參考損益」一致；市值、總資產不扣
- **美股損益拆兩部分**：股價漲跌、匯率變動
- **報酬率**：時間加權報酬率（TWR），排除入金、出金的影響
- **比較基準**：0050、VOO（換成台幣）
- 不處理：股票分割、減資、T+2 交割時差（交易日就扣現金）

## 成品

`outputs/briefs/<日期>.md`：每日持股晨報，由排程產生並歸檔
