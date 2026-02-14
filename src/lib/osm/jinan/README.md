# lib/osm/jinan 目录说明

该目录实现“济南地铁 OSM 导入”完整流程，按职责拆分：

- `constants.js`
  - Overpass 查询模板、行政边界对象、站点匹配正则与拓扑合并阈值
- `status.js`
  - 线路/站点状态判定（open/construction/proposed）与过滤逻辑
- `naming.js`
  - 线路命名规范化、环线识别、站名读取
- `topology.js`
  - 元素索引、relation 邻接构建、最短路、同站合并、边/线重映射
- `importer.js`
  - 导入主流程编排（请求、解析、过滤、合并、返回标准工程结构）

输出结构：

- `stations` / `edges` / `lines`
- `region` / `boundary` / `importMeta`
