# lib/export 目录说明

导出模块，负责将当前工程示意图输出为发布素材。

- `exportSchematic.js`
  - `buildSchematicSvg(project, options)`：生成 SVG 字符串。
    - 基于 `lib/schematic/renderModel.js` 统一渲染模型输出
    - 支持共线偏移、圆角折线、城市标题、标签布局元数据
  - `downloadSvg(project)`：下载 SVG 文件。
  - `downloadPng(project, options)`：通过 SVG 转 Canvas 导出 PNG。

主要使用数据：

- `project.stations`（站点坐标、名称）
- `project.edges`（连线拓扑）
- `project.lines`（线路颜色）
