# src

前端应用核心代码。

## 根目录文件

- **main.js** — 应用挂载、全局依赖注入与缓存主题/字体预加载
- **style.css** — 全局样式与主题变量（包含日间/夜间色板、全局字体变量与工作区统一风格令牌）

## 子目录

- **components/** — 页面组件（地图编辑、工具栏、示意图视图、车辆 HUD 视图），详见 `components/README.md`
- **composables/** — Vue 3 Composition API composables，封装可复用的组件逻辑，详见 `composables/README.md`
- **data/** — 内置静态数据（如济南行政边界 GeoJSON），详见 `data/README.md`
- **lib/** — 通用业务库（导入、导出、布局、示意图渲染模型、车辆 HUD 渲染模型、全球轨道交通排名、AI 命名、存储、工具函数），详见 `lib/README.md`
- **stores/** — Pinia 状态管理，详见 `stores/README.md`
- **workers/** — Web Worker 计算任务，详见 `workers/README.md`
