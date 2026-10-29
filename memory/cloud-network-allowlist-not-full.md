---
name: cloud-network-allowlist-not-full
description: 雲端環境網路建議用 Custom 白名單而不是 Full；TTS API 網域不用加
type: project
---

2026-10-29 討論雲端網路設定：建議保留 Trusted 預設，再用 Custom 加上 `cdn.jsdelivr.net`、`fonts.googleapis.com`、`fonts.gstatic.com`、`storage.googleapis.com`、`googlechromelabs.github.io`（motion-video 渲染需要）；Tristan 輪播找照片另需 `api.unsplash.com`、`images.unsplash.com`（只有 api 不夠，照片檔從 images 下載）。使用者當時考慮開 Full，最後的決定未知。

**Why:** 雲端 session 會讀外部內容，Full 模式下 prompt injection 能把 repo 內容傳到任意網站；雲端不放密鑰，所以 MiniMax、ElevenLabs 由 GitHub Actions 呼叫，不需要加進白名單。

**How to apply:** 雲端出現網路錯誤時，把錯誤訊息裡的網域補進 Custom 清單，不要建議直接開 Full。
