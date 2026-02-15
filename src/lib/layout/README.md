# lib/layout

布局模块主线程侧，负责与 Web Worker 通信。

## 文件说明

- **workerClient.js** — 懒加载创建 Worker 实例，维护请求队列，暴露 `optimizeLayoutInWorker(payload)` 供 Store 调用。真正的优化算法实现位于 `src/workers/layoutWorker.js`。
