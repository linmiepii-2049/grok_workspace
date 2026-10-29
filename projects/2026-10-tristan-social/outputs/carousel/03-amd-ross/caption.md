做 FPGA 的朋友注意：AMD 推出了自家的 AI 助手 Ross 🤖

Ross（AMD Ross Agentic AI Assistant）把 AMD 嵌入式開發工具的常見流程做成 AI 技能，在 Claude Code、Cursor、GitHub Copilot 裡用自然語言就能叫它做事。

它會做的 4 類事：
1️⃣ Vivado：RTL 模擬、Lint、時序方法檢查、用一句話設定 IP
2️⃣ Vitis HLS：MATLAB 轉 C++，對著效能和資源目標反覆優化 kernel
3️⃣ 硬體除錯：在板子上觸發 ILA 抓波形、讀寫 VIO
4️⃣ Vitis AI：ONNX 模型量化（INT8／BF16），部署到 AMD NPU

怎麼裝：
① AMD 官網登入帳號，下載 VS Code／Cursor 擴充，或 Windows／Linux 版 MCP Server
② 到 GitHub xilinx/ross-ai-assistant，用 npx skills add 安裝技能
③ 在你慣用的 AI 工具裡開始下指令

⚠️ Ross 底層還是呼叫 Vivado，要先有工具和授權
⚠️ 擴充和 MCP Server 二選一，不要同時裝
📚 官方文件可以下載到本機查（含嵌入模型，約 3～4 GB）

身邊有做 FPGA 的？分享給他 👇

#AMD #FPGA #Vivado #Vitis #HLS #AI工具 #ClaudeCode #嵌入式開發

封面照片：Vishnu Mohanan on Unsplash
