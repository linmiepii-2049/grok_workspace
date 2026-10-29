---
name: tristan-carousel-style
description: Tristan IG 輪播的固定規格：封面放該篇代表照片、最後一頁放 Tristan 形象照、標題字型、帳號
type: feedback
---

2026-10-29 確認 Tristan IG 輪播（`projects/2026-10-tristan-social/carousel/`）的規格：

- 封面放「這篇文最有代表性的照片」，每篇不同；照片直接填進左上角的綠色大圓，不另開照片框；用原本的彩色，不轉黑白（2026-10-29 使用者指定）
- 最後一頁（CTA）放 Tristan 的形象照：彩色、灰綠背景那張（`carousel/assets/tristan.jpg`），和主色灰綠最搭
- 標題字型用思源黑體 Thin（weight 200）縱向拉長 1.18 倍；不用找「文青木瓜」原字
- IG 帳號：@tris.tan.2049
- 版型（整套風格）放 `carousel/themes/<id>/`，使用者會給參考圖讓我做新版型；每套做完跑 `node preview.mjs <id>` 輸出預覽到 `outputs/templates/<id>.png`，使用者在 jteam-viewer 看 id 後指定發文用哪套
- 已有版型：`beige-teal`（文青米白）、`collage-navy`（藍調拼貼：灰藍／藏青／米色紙輪流、撕紙邊、原子筆塗鴉、白色小花、襯線標題壓色塊；照片仍用彩色）、`editorial-beige`（雜誌米杏：米杏底、Playfair／思源宋體、焦糖色圓點、手寫體點綴、金細線頁尾）
- 配色參考使用者給的 Canva 模板：米白底，搭配灰綠、磚紅、杏橘

**Why:** 使用者看過試做稿後指定的。
**How to apply:** 做 Tristan 輪播時，每篇都要準備封面照片放進 `carousel/assets/`；不要退回只用文字或系列代表字的封面。
