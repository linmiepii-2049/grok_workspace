// 產生 Open Peeps 人物 SVG（Pablo Stanley，CC0，不用標示來源），透過 react-peeps（MIT）組合
// 套件不放進 repo 依賴，要新增人物時在暫存資料夾裝一次：
//   npm i --no-save --prefix <暫存資料夾> react-peeps react@17 react-dom@17
//   NODE_PATH=<暫存資料夾>/node_modules node reels/kit/peeps/gen.cjs
// 人物清單在 peeps.json：name → { body, face, hair, accessory?, facialHair? }，可選部件見 react-peeps 的 lib/peeps/
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const Peep = require("react-peeps").default;

const dir = __dirname;
const list = JSON.parse(fs.readFileSync(path.join(dir, "peeps.json"), "utf8"));
for (const [name, parts] of Object.entries(list)) {
  // 線條用墨色、填色用卡片白，跟 beige-teal 一致
  const svg = renderToStaticMarkup(React.createElement(Peep, { ...parts, strokeColor: "#3A3836", backgroundColor: "#FBF8F3" }));
  fs.writeFileSync(path.join(dir, `${name}.svg`), svg.replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ') + "\n");
  console.log(`${name}.svg`);
}
