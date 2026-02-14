# src 目录说明

`src` 是前端应用核心代码目录，按职责拆分为以下模块：

- `components/`：页面组件（地图编辑、工具栏、示意图视图、车辆 HUD 视图）。
  - `components/map-editor/`：`MapEditor.vue` 的纯函数/常量子模块。
- `data/`：内置静态数据（如济南行政边界 GeoJSON）。
- `lib/`：通用业务库（导入、导出、布局、示意图渲染模型、车辆 HUD 渲染模型、存储、工具函数）。
- `stores/`：Pinia 状态管理。
  - `stores/project/`：`projectStore` 的模块化 action 与 helper 实现。
- `workers/`：Web Worker 计算任务。
  - `workers/layout/`：自动排版算法分模块实现。

入口文件：

- `main.js`：应用挂载、全局依赖注入与缓存主题预加载。
- `App.vue`：主布局容器（含左侧工具栏收起/展开状态持久化、页面关闭/刷新二次确认）。
- `style.css`：全局样式与主题变量（包含日间/夜间色板与工作区统一风格令牌）。
