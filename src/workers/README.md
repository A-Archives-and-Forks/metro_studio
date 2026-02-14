# workers 目录说明

该目录存放 Web Worker 计算任务。

- `layoutWorker.js`
  - Worker 入口层（消息收发、错误封装）
  - 调用 `layout/optimizeLayout.js` 执行排版
- `layout/`
  - 自动排版算法实现（已按子模块拆分）
  - 详见 `layout/README.md`

目的：

- 将重计算从主线程移出，保持编辑交互流畅。
