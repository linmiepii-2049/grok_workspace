// 持股晨報：把持股變化、新聞、近期事件交給 Claude 寫成一篇繁中文章
// Claude 只會看到新聞編號，連結由程式代入，所以文章裡不會出現編造的網址
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-haiku-5-5";

const SYSTEM = `你是個人投資組合的財經編輯，每天早上替持有人寫一篇「持股晨報」。

寫作規則：
- 使用繁體中文與台灣慣用語（例如「營收」「財報」「法說會」「聯準會」），不要用中國大陸用語
- 只根據提供的資料寫；新聞沒提到的原因不要自己推測成事實，不確定就說「新聞未說明」
- 每個引用新聞的句子後面加上來源編號，格式是 [n12]，可以連續放多個 [n3][n7]；只能使用資料裡有的編號
- 不提供買賣建議、目標價或「應該加碼／減碼」之類的建議；只整理發生了什麼、可能的影響、接下來要注意什麼
- 金額用台幣，千分位加逗號；漲跌幅保留兩位小數

文章結構（Markdown）：
# 第一行是標題：一句話點出今天最重要的事
## 今日總覽
2～3 句：總資產變化、主要漲跌來源
## 持股重點
依影響大小排序，每檔持股一個 ### 小標（名稱＋代號＋漲跌幅），寫 2～4 句；沒有新聞的持股合併成一段簡短帶過
## 市場動態
台股、美股大盤與總經重點，3～5 點
## 接下來要注意
未來 7 天的財報、除息、總經公布日，用條列`;

const pct = (n) => (n == null ? null : Math.round(n * 10000) / 100);

export function buildInput({ today, latest, previous, news, events, names }) {
  const dayChange = previous ? latest.total - previous.total - latest.net_flow : null;
  const holdings = latest.positions.map((p) => ({
    symbol: p.symbol, name: p.name, weight_pct: pct(p.weight),
    change_pct: p.prev_close ? pct(p.close / p.prev_close - 1) : null,
    unrealized_twd: p.unrealized,
  }));
  const ids = new Map();
  const items = news.map((n, i) => {
    const id = `n${i + 1}`;
    ids.set(id, n);
    return {
      id, symbol: n.symbol === "*" ? "大盤" : n.symbol, name: names[n.symbol] ?? null,
      title: n.title, source: n.source, summary: n.summary?.slice(0, 400) ?? null, published_at: n.published_at,
    };
  });
  const input = {
    today, data_date: latest.date,
    portfolio: {
      total_twd: latest.total, day_change_twd: dayChange, day_change_pct: dayChange != null && previous.total ? pct(dayChange / previous.total) : null,
      twr_since_start_pct: pct(latest.twr), usd_twd: latest.fx_usd,
    },
    holdings,
    news: items,
    upcoming_events: events.map((e) => ({ date: e.date, title: e.title, detail: e.detail })),
  };
  return { input, ids };
}

// [n12] → [來源](網址)；文章裡其他不在新聞清單的網址只留文字
export function linkify(markdown, ids) {
  const allowed = new Set([...ids.values()].map((n) => n.url));
  return markdown
    .replace(/\]\((https?:[^)\s]+)\)/g, (m, url) => (allowed.has(url) ? m : "]"))
    .replace(/\[(?!n\d+\])([^\]]+)\](?!\()/g, "$1")
    .replace(/\[n(\d+)\]/g, (_, n) => {
      const item = ids.get(`n${n}`);
      return item ? ` [${item.source || "來源"}](${item.url})` : "";
    })
    .replace(/[ \t]+\n/g, "\n");
}

export async function writeBrief(payload) {
  const { input, ids } = buildInput(payload);
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: `今天的資料（JSON）：\n\n${JSON.stringify(input, null, 1)}\n\n請寫今天的持股晨報。` }],
  });
  if (response.stop_reason === "refusal") throw new Error(`Claude 拒絕產生晨報：${response.stop_details?.explanation ?? "未說明原因"}`);
  if (response.stop_reason === "max_tokens") throw new Error("晨報超過長度上限，被截斷");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const body = linkify(text, ids);
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `${payload.today} 持股晨報`;
  return { title, body, model: response.model, usage: response.usage };
}
