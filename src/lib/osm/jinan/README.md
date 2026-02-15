# lib/osm/jinan

济南地铁 OSM 导入实现。

## 文件说明

- **constants.js** — Overpass 查询模板、行政边界对象、站点匹配正则、拓扑合并阈值
- **status.js** — 线路/站点状态判定（open/construction/proposed）与过滤逻辑
- **naming.js** — 线路命名规范化、环线识别、站名读取
- **topologyGraph.js** — 通用图算法（MinHeap、UnionFind、Dijkstra、连通分量）
- **topology.js** — 元素索引、relation 邻接构建、同站合并、边/线重映射
- **importer.js** — 导入主流程编排，输出标准工程结构（stations/edges/lines/region/boundary/importMeta）
