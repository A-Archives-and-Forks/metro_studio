# lib/osm 目录说明

该目录负责 OSM 数据导入链路。

- `overpassClient.js`
  - 封装 Overpass 请求
  - 支持主/备端点重试（开发代理 + 公网端点）
  - 单端点超时控制与失败链路聚合
- `importJinanMetro.js`
  - 对外兼容入口（转发到 `jinan/importer.js`）
- `jinan/`
  - 济南导入实现子模块（查询、状态判定、命名、拓扑合并、导入主流程）
  - 详见 `jinan/README.md`

当前区域配置：

- 济南市行政区（relation `3486449`）
