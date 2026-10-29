---
name: chinese-tts-use-minimax
description: 中文旁白一律用 MiniMax，ElevenLabs 只用在英文
type: feedback
---

中文旁白用 MiniMax（`speech-2.8-hd`，使用者選的聲音是 `Chinese_casual_instructor_nv1`），ElevenLabs 只留給英文配音。

**Why:** 2026-10-29 試作片用 ElevenLabs 產生中文旁白，使用者聽過後判定「ElevenLabs 中文不行」，改用 MiniMax。

**How to apply:** 做影片或任何中文 TTS 時，預設 provider 用 minimax；挑聲音時先用第一句產生幾段試聽讓使用者選。motion-video skill 的 `tts.mjs` 已支援兩種 provider。
