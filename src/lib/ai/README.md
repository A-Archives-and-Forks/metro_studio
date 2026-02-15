# lib/ai

AI 能力调用封装。

## 文件说明

- **openrouterClient.js** — 统一 Chat Completions 请求（`postLLMChat`），默认 `https://api.bltcy.ai/v1/chat/completions`，支持超时/取消/鉴权/错误处理
- **stationNaming.js** — 两阶段站点命名生成（第一阶段生成中文站名，第二阶段翻译为英文）。调用 BLTCY 兼容 API（默认模型 `gemini-2.5-flash`）。支持单站点和批量接口。
- **stationEnTranslator.js** — 分批重译全图英文站名，输出进度回调（done/total/percent）。使用 `response_format(json_schema)` 降低批量翻译格式漂移。
