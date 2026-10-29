# 中文排版

## 字型

HyperFrames 內建的字型只有拉丁字，中文字型要自己放進專案，渲染時才不會因為網路或快取變成方框或系統字。

1. 用 `node scripts/fonts.mjs <aspect 專案資料夾> "Noto Sans TC:700" "Noto Serif TC:700"` 下載字型子集到 `assets/fonts/`。它收集 HTML 裡出現的字，只下載這些字的字形，中文字型從數 MB 降到幾十 KB。改了文案要重跑
   - 預設黑體：Noto Sans TC（400、700、900）
   - 預設明體：Noto Serif TC（400、700）
   - 其他字型照 `FRAME.md`，先確認授權允許商用
2. 把腳本印出的 `@font-face` 貼進 `<style>`，格式如下：

```css
@font-face {
  font-family: "Noto Sans TC";
  src: url("assets/fonts/NotoSansTC-Bold.woff2") format("woff2");
  font-weight: 700;
}
```

3. 拉丁字和數字用 FRAME.md 指定的拉丁字型，放在 font-family 的前面：`font-family: "Inter", "Noto Sans TC", sans-serif;`。中文字型的拉丁字通常比較鈍

## 字幕

| 比例 | 每行字數 | 行數 | 理由 |
|---|---|---|---|
| 9:16 | 12–14 字 | 最多 2 行 | 手機寬 360px 下仍可讀 |
| 16:9 | 18–22 字 | 最多 2 行 | 電視和電腦螢幕的閱讀距離 |
| 4:5、1:1 | 14–16 字 | 最多 2 行 | 介於兩者之間 |

- 在語意停頓的地方斷行，不在詞的中間斷，例如「人工／智慧」是錯的
- 句尾的句號、逗號不放進字幕；問號、驚嘆號保留，因為它們有語氣
- 字幕時間用 `voiceover.json` 產生的逐字時間碼，見 `audio.md`
- 停留時間至少要讀得完：中文每秒約 4–5 字。HyperFrames 的 `line_unread` 警告會抓出太短的字幕

## 標題與大字

- 中文標題字距比拉丁字略寬一點（`letter-spacing: 0.02em` 起跳），太緊會黏在一起
- 單行標題不要超過 10 個中文字，超過就拆成兩行或縮短文案
- 數字和單位之間不加空格（`30秒`），中英文之間加半形空格（`用 AI 寫`）
