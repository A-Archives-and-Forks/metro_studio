# workers/layout

自动排版算法实现。

## 文件说明

- **config.js** — 排版默认参数集合（温度衰减、八方向约束、标签松弛、间距硬约束）
- **optimizeLayout.js** — 排版主流程编排（迭代、硬约束、评分、返回 layoutMeta）
- **forces.js** — 力导向阶段与几何预处理（锚定力、弹簧力、排斥力、交汇扇出、交叉排斥、位移约束）
- **constraints.js** — 八方向硬约束、最小边长约束、最小站间距约束
- **linePlanning.js** — 线路链路抽取与方向动态规划（转折/短折惩罚）
- **labelPlacement.js** — 标签放置算法核心（碰撞检测、候选位置生成、重叠惩罚计算）
- **labels.js** — 站名标签布局集成接口（computeStationLabelLayout），调用 labelPlacement 的放置算法
- **scoring.js** — 评分分解与数值清洗
- **shared.js** — 通用数学/几何与空间索引工具（角度归一化、相交判定、距离计算、网格邻域遍历、共享端点判定）
