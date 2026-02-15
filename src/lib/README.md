# lib 目录说明

该目录存放核心业务逻辑与通用函数，按子域拆分：

- `colors.js`：线路颜色选择与颜色规范化（含基于现有线路颜色差异度的自动选色）。
- `geo.js`：地理/几何计算（投影、距离、相交、包围盒、八向折线路径生成，含近似直线合并避免阶梯化）。
- `ids.js`：全局 ID 生成。
- `lineNaming.js`：线路命名工具（环线名去“起终点”后缀、显示名归一化）。
- `lineStyles.js`：线路线型定义与归一化（单线/双线、虚线、点线等跨渲染层配置）。
- `projectModel.js`：工程数据模型与标准化（含线路状态、线型、自动排版配置 `layoutConfig`、线段级线型覆盖 `lineStyleOverride`）。
- `transfer.js`：手动换乘关系工具（站点对归一化、换乘联通分组、有效换乘线路集合计算）。
- `uiPreferences.js`：UI 主题/字体偏好定义与归一化（本地持久化键、选项集、默认值、`getActiveFontFamily()` 获取当前用户字体 CSS family 字符串）。
- `ai/`：LLM 能力封装（站点命名候选生成、结构化 JSON 校验与回退）。
- `hud/`：车辆 HUD 渲染模型（线路主路径、方向、换乘标识、超长单弯折返）。
- `export/`：导出逻辑（实际走向图 PNG、官方风格图 PNG、车辆 HUD ZIP）。
- `layout/`：布局 Worker 调用端。
- `ranking/`：全球轨道交通排行榜与工程里程排名计算（Wikipedia 实时榜单解析）。
- `schematic/`：示意图渲染模型（预览与导出共享，支持线段级线型覆盖）。
- `osm/`：OSM 导入与 Overpass 请求。
  - `osm/jinan/`：济南导入主流程分层实现（查询、命名、状态、拓扑、入口编排）。
  - `osm/nearbyStationNamingContext.js`：按半径提取站点周边命名语义要素（道路、地域、公共设施、建筑）。
- `storage/`：本地存储与工程文件读写（含线段级线型覆盖持久化）。
- `timeline/`：时间轴动画引擎。
  - `timelineAnimationPlan.js`：预计算逐年/逐线路渐进绘制计划（边排序、BFS、累计进度标记、站点揭示触发点）；BFS 基于边（非节点）遍历并记录实际遍历方向，正确处理环线（cycle）的所有边；当 BFS 遍历方向与边存储方向相反时自动翻转 waypoints，确保动画始终从旧站向新站绘制；排序处理所有连通分量（非仅最大），优先从连接已有网络的端点站启动，避免从中间站开始绘制；提供 `buildTimelineAnimationPlan`（基于 `openingYear`）与 `buildPseudoTimelineAnimationPlan`（基于 `project.lines` 数组顺序的伪发展史）。
  - `timelinePreviewRenderer.js`：Canvas 2D 实时播放引擎（状态机、瓦片底图、叠加层）。采用连续绘制模式：将所有年份的线段展平为全局 0→1 进度，从第一站一路画到最后一站。播放速度基于总公里数（1.6s/km × speed 倍率），速度挡位 0.2x–5x。内置线头跟踪相机：delta-time 指数平滑（半衰期 800ms），宽视野跟随绘制线头。`buildContinuousPlan` 确保环线段方向连续，避免镜头振荡。支持 `pseudoMode` 切换伪线序预览。瓦片策略：播放前 `precacheTilesForAnimation` 沿时间线采样 30 个相机位置预加载所需瓦片（含 ±1 zoom），播放期间不再逐帧 prefetch（`renderTiles` 自身对缺失瓦片按需 fetch 作为兜底）；`onTileLoaded` 仅在 idle 状态触发重绘，播放中由 RAF 循环驱动，避免冗余帧调度。加载阶段扫描线动画：`loading` 状态下立即启动 RAF 循环，通过 `TileCache.startProgressTracking()` 获取实时瓦片加载进度，驱动 `renderScanLineLoading()` 绘制扫描线动画（发光扫描线从上到下扫过画布，上方显示已加载瓦片，下方为暗色虚线网格，左下角百分比+呼吸脉冲提示文字）；进度使用指数平滑（半衰期 400ms，不回退）；快速加载（<500ms 且已完成）跳过动画直接播放；完成后 smoothedProgress snap 到 1.0 并保持 300ms 再进入播放；暂停/停止/销毁时正确清理进度追踪与 RAF。动画系统包括：站点弹出（easeOutBack 缩放）、换乘站变形（圆→圆角矩形 morph，第二条线接入时触发）、年份切换交叉淡入淡出、统计数字递增滚动、事件横幅左侧滑入、线路卡片统计递增。
  - `timelineCanvasRenderer.js`：Canvas 绘制原语（边/站点/叠加层）。站点渲染支持 `stationAnimState` 动画参数（popT 弹出、interchangeT 换乘变形、labelAlpha 标签淡入）。叠加层包括：左上角事件横幅（半透明深色圆角矩形+线路色条+线路名开通运营+英文副标题，支持 slideT 滑入动画）、底部左侧年份+统计药丸块（支持 yearTransition 交叉淡入淡出+displayStats 数字递增）、底部左侧线路卡片列表（独立彩色圆角矩形卡片+右侧 KM/ST 竖排统计，支持滑入动画+displayLineStats 数字递增，苹方粗体）、线头发光（renderTipGlow 径向渐变脉冲）、扫描线加载动画（`renderScanLineLoading()` 全画布暗色底+虚线网格+clip 瓦片+渐变发光扫描线+百分比数字+呼吸脉冲副标题）、比例尺（仅导出器使用）、OSM 归属。线路卡片自适应布局：单列超出可用高度时自动缩小（最小 70%），仍超出则分两列显示，两列模式下线路名缩写为首字（"1号线"→"1"，"云巴线"→"云"）且隐藏右侧 km/st 统计。中文字体栈统一为 `"微软雅黑 Timeline", "Source Han Sans SC", "Microsoft YaHei", sans-serif`，通过 `loadSourceHanSans()` 使用 FontFace API 从本地 `public/PingFang-Bold.ttf` 加载苹方粗体。缓动函数：easeInOutCubic、easeOutCubic、easeOutBack、easeOutElastic。
  - `timelineTileRenderer.js`：OSM 瓦片缓存与渲染（分数 zoom 对齐、`onTileLoaded` 回调、并发控制）。当高 zoom 瓦片未加载时，自动回退绘制已缓存的低 zoom 祖先瓦片（最多向上查找 4 级），避免灰色占位块。`TileCache` 提供进度追踪 API：`startProgressTracking(onProgress)` 初始化计数器并注册回调、`stopProgressTracking()` 清除追踪并返回最终计数、`getProgress()` 返回当前 `{ loaded, total }`；`fetch()` 中缓存命中立即计 total+loaded，新建请求计 total，`_store()` 和 `onerror` 各计 loaded（失败也算完成，避免进度卡住）。
