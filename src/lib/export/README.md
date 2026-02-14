# lib/export 目录说明

导出模块，负责将当前工程输出为发布素材。

- `exportSchematic.js`
  - `buildSchematicSvg(project, options)`：生成 SVG 字符串。
    - 基于 `lib/schematic/renderModel.js` 统一渲染模型输出
    - 支持共线偏移、圆角折线、标签布局元数据（无图例/区名/标题文字）
    - 支持线路线型导出（实线/虚线/点线）
    - `mirrorVertical=false` 可输出“实际走向”方向，`true` 输出“官方风格”镜像方向
  - `downloadOfficialSchematicPng(project, options)`：导出官方风格图 PNG（Y 轴镜像）。
  - `downloadAllLineHudZip(project, options)`：按所有线路与方向批量渲染车辆 HUD PNG，并 ZIP 打包下载。
    - 内部基于 `lib/hud/renderModel.js` 的线路路由与 HUD 渲染模型
    - 依赖 `jszip` 进行浏览器端打包

主要使用数据：

- `project.stations`（站点坐标、名称）
- `project.edges`（连线拓扑）
- `project.lines`（线路颜色）
