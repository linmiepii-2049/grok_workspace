# 輪播版型

每套版型一個資料夾，資料夾名稱就是版型 id（英文小寫、用 `-` 連接，例如 `beige-teal`）。

| 檔案            | 內容                                                                        |
| --------------- | --------------------------------------------------------------------------- |
| `theme.json`    | id、中文名稱、尺寸、配色、字型                                              |
| `template.html` | 7 種頁型（cover、statement、compare、steps、beforeafter、quote、cta）的排版 |

帳號資料（名稱、IG 帳號、形象照）放在 `../profile.json`，所有版型共用。

## 新增版型

1. 複製一套現有版型成新資料夾，依參考圖改 `theme.json` 和 `template.html`
2. 7 種頁型都要支援，貼文才能自由換版型
3. `node preview.mjs <id>` 產生預覽圖到 `outputs/templates/<id>.png`，推上去後在 jteam-viewer 看

## 使用版型

貼文 JSON 加 `"theme": "<id>"`，或渲染時臨時指定：`node render.mjs posts/xx.json <id>`
