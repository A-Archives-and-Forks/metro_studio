# RailMap

基于 `Vue 3 + Vite` 的架空地铁图工具，支持：

- 在真实 OSM 地图上做站点/线段编辑
- 导入济南市地铁线网（可选包含在建/规划）
- 支持支线与共线的数据模型
- 手动触发“官方风”自动排版（八方向约束 + 惩罚评分）
- 工程本地持久化（IndexedDB）
- 工程文件保存/加载（`.railmap.json`）
- 导出示意图 `SVG` 和高分辨率 `PNG`
- 关闭/刷新页面二次确认（防误关）

## 开发运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 关键实现说明

- OSM 导入:
  - 使用 Overpass API 查询济南市 (`relation 3486449`) 区域内 `subway/light_rail` 路由关系。
  - 在建判定: `route=construction` 或 `state=construction` 或 `construction=subway|light_rail`。
  - 规划判定: `state=proposed` 或 `proposed=subway|light_rail`。
- 边界过滤:
  - 使用内置济南行政边界 GeoJSON（来源于 OSM/Nominatim 的 `R3486449`）做点位过滤。
- 自动排版:
  - 在 Web Worker 执行，避免阻塞主线程。
  - 地理锚定优先：保持原地理骨架，不做拓扑主导重排。
  - 通过八方向规整、交汇扇出、交叉排斥与位移上限约束提升可读性。
  - Worker 返回 `layoutMeta`（站名锚点、边方向）供预览与导出复用。
  - 评分项包含角度偏差、长度偏差、转折惩罚、短折线惩罚、交叉、站点重叠、地理偏移、标签重叠。
- 示意图渲染与导出:
  - 连线使用八向圆角折线，支持共线偏移、线路状态透明度分层。
  - 预览与导出共享统一渲染模型，保证界面与文件视觉一致。
  - 示意图视图支持滚轮缩放、中键平移，并自适应铺满视图窗口。
- 稳定性:
  - IndexedDB 入库前执行可序列化投影，避免响应式对象导致 `DataCloneError`。
  - Overpass 导入采用代理优先 + 公网回退 + 超时控制，降低单端点故障影响。

## 数据存储

- IndexedDB:
  - `projects`: 工程对象
  - `meta`: 最近工程指针
- 工程文件格式:
  - JSON，包含 `projectVersion`，用于后续迁移兼容。
