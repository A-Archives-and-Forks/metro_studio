# lib/ai 目录说明

该目录封装本机 AI 能力调用。

- `stationNaming.js`
  - 调用本机 Ollama（优先开发代理 `/api/ollama`，回退 `127.0.0.1/localhost:11434`）
  - 向模型提交结构化命名约束与周边 OSM 语义上下文
  - 强制解析并校验 5 个候选（`nameZh/nameEn/basis/reason`）
  - 模型响应不完整时使用周边要素做规则回退，仍不足则报错

约束：

- 命名候选必须基于输入上下文，不允许虚构周边地名或设施名。
