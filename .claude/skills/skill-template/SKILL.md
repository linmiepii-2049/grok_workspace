---
name: skill-template
description: Use when the user asks to test whether JT-Skills is installed, with phrases like 測試 JT-Skills、skill 有裝好嗎、jt-skills check. Replies with a fixed confirmation line so the install can be verified on any device.
---

# Skill 範本

這個 skill 有兩個用途：

1. 用 `scripts/new-skill.sh <name>` 建立新 skill 時，複製這份當起點
2. 驗證 JT-Skills 在本機或雲端 session 有沒有裝好

## 步驟

1. 回覆下方固定格式的確認訊息
2. 列出目前工作目錄，證明 skill 是在這個環境被載入的

## 輸出格式

```
✅ JT-Skills 已安裝（skill-template）
工作目錄：<目前的工作目錄>
```

## 寫新 skill 時

- 先讀 repo 根目錄的 `docs/cloud-ready.md`，確認 skill 能在雲端 session 執行
- 成品一律寫到 `projects/<slug>/outputs/`，才會被自動歸檔到 R2
- 密鑰只從環境變數讀取，不寫進任何檔案
