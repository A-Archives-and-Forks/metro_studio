# lib 目录说明

该目录存放核心业务逻辑与通用函数，按子域拆分：

- `colors.js`：线路颜色选择与颜色规范化。
- `geo.js`：地理/几何计算（投影、距离、相交、包围盒、八向折线路径生成）。
- `ids.js`：全局 ID 生成。
- `projectModel.js`：工程数据模型与标准化。
- `export/`：导出逻辑（SVG/PNG）。
- `layout/`：布局 Worker 调用端。
- `schematic/`：示意图渲染模型（预览与导出共享）。
- `osm/`：OSM 导入与 Overpass 请求。
- `storage/`：本地存储与工程文件读写。
