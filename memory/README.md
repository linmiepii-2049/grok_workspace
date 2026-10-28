# 記憶格式

每條記憶一個檔案，只寫一件事：

```markdown
---
name: <kebab-case，和檔名相同>
description: <一行摘要，用來判斷什麼時候相關>
type: user | feedback | project | reference
---

<內容。feedback 和 project 類型接著寫：>
**Why:** 為什麼重要
**How to apply:** 什麼時候、怎麼套用
```

| type      | 用途                                       |
| --------- | ------------------------------------------ |
| user      | 使用者是誰、專長、偏好                     |
| feedback  | 使用者的糾正與肯定過的做法                 |
| project   | 進行中的工作、目標、限制（日期寫絕對日期） |
| reference | 外部資源的位置（網址、儀表板）             |

規則：

- 新增前先檢查有沒有已經涵蓋的檔案，有就更新，不要重複
- 發現錯誤的記憶就刪掉
- repo 已經記錄的東西（程式結構、git 歷史、CLAUDE.md）不要再存
