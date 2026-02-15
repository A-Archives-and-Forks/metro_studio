# lib/hud

车辆 HUD 渲染模型生成。

## 文件说明

- **MinHeap.js** — 最小堆数据结构，供 Dijkstra 算法使用
- **hudGraphAlgorithms.js** — 图算法集合（ensureNode、findLargestConnectedComponent、traceCycle、findFarthestPair、buildShortestPath、dijkstra）
- **hudGeometry.js** — HUD 几何与布局辅助函数（圆角路径、换乘标识尺寸、站间距、标注范围估算等）
- **renderModel.js** — 从工程数据提取线路主路径，生成 HUD 渲染模型（站序、换乘标识、方向箭头、双层环线布局、超长线折返）
- **jinanBrand.js** — 济南地铁品牌矢量资源常量（Logo 路径与颜色）
