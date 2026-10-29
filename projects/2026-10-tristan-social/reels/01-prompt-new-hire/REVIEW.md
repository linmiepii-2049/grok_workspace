# 自檢紀錄

成品：outputs/video/reels-01-prompt-new-hire-9x16.mp4（0:37，1080×1920，30fps，-14.2 LUFS）

- L1：lint＋check 0 error；剩 4 個 warning 都是刻意的（舊版回覆卡、前一段已出現過的 Prompt 停留較短；數字跳動的 proxy 物件）
- L2／L3：看過兩輪 review-beats，修掉的問題：
  - 手繪線一開場就出現、線段斷掉（pathLength 和 non-scaling-stroke 衝突，改成像素座標）
  - 拉長標題的字腳被遮罩切掉（標題下方留 0.3em）
  - 「之前」標籤壓到系列標、標題碰到字幕
  - 灰綠文字對比不足（加 teal-ink、teal-deep）
  - 「少改 3 次」太晚出現、第二段空標籤槽沒出現
- 使用者回饋：節奏要快 → 旁白語速 1.2 倍、句間停頓 0.18 秒（44 秒 → 37 秒）；不放音樂
- 沒驗證到：聲音只量過響度（sample peak -0.8 dBFS，略高於 -1 dBTP 目標），沒有人耳聽過音效和旁白的平衡
- 最弱的一段：第二段「下 Prompt ＝ 交代新人」下半部留白多
