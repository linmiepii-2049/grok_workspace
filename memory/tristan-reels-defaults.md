---
name: tristan-reels-defaults
description: Tristan 字卡 Reels 的系列設定：元件化、MiniMax 語速 1.2、不放音樂
type: feedback
---

2026-10-29 第 1 支 Reels（Prompt 就像交代新人）確認：

- 做法：基礎元件（`projects/2026-10-tristan-social/reels/kit/`），每集只寫 `episode.json`，不要做成整支固定模板（使用者擔心每支長得一樣）
- 旁白：MiniMax `Chinese_casual_instructor_nv1`，`voice_settings.speed: 1.2`，句間停頓 0.18 秒（使用者嫌原速太慢）
- 不放背景音樂
- 旁白一律推上 `voiceover.json` 由 GitHub Actions `tts` workflow 產生（雲端 session 沒有密鑰）

**Why:** 使用者看過 1.0 倍草稿後要求「節奏要快一點，1.2x」，看完 1.2 倍版同意並說先不放音樂。
**How to apply:** 新一集直接用這些設定，不用再問語速和音樂；細節見 `reels/README.md`。
