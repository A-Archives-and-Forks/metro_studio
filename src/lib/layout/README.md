# lib/layout 目录说明

布局模块（主线程侧），负责与 Web Worker 通信。

- `workerClient.js`
  - 懒加载创建 Worker 实例
  - 维护请求队列（`requestId -> Promise`）
  - 暴露 `optimizeLayoutInWorker(payload)` 供 Store 调用

说明：

- 真正的优化算法实现位于 `src/workers/layoutWorker.js`。
- Worker 采用“地理锚定优先”布局策略，并返回 `layoutMeta`（标签锚点与边方向）。
- 主线程侧仅透传 `stations/edges/lines`，并消费 Worker 返回结果。
