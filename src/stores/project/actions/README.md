# stores/project/actions 目录说明

该目录按职责拆分 `projectStore` actions：

- `lifecycle.js`
  - 工程生命周期（初始化、新建、重命名、复制、删除、按 ID 加载、列表）
- `selection.js`
  - 交互状态（模式、当前线路、站点选择、多选、连续布线选择逻辑；模式含 AI 点站）
- `networkEditing.js`
  - 线网编辑（加站、连线、站点/线路更新、锚点编辑、删除、线路归属重算）
  - 手动换乘关系编辑（两站绑定/解绑为换乘，不改原始线网拓扑）
  - 线路线型写入前统一归一化（支持单线/双线/虚线/点线等样式）
- `importLayout.js`
  - OSM 导入与自动排版触发（导入会新建工程，避免覆盖当前工程）
- `exportPersistence.js`
  - 工程文件导入导出、PNG/HUD 导出、持久化节流、真实地图导出器注册

说明：

- 文件拆分后方法名保持一致，`projectStore.js` 通过对象展开聚合。
