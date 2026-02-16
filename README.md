# RailMap

济南地铁线路图编辑与生成工具。

## 这是什么

RailMap 是一个基于真实地图的地铁线路图编辑器，可以：

- **在真实地图上绘制线路** — 在 OpenStreetMap 底图上点站、拉线、编辑线路
- **自动生成官方风格示意图** — 一键生成八方向规整的地铁示意图
- **导出多种格式** — 实际走向图 PNG、官方风格图 PNG、车辆 HUD 显示屏图片
- **AI 辅助命名** — 自动分析周边道路、设施，生成站点中英文名称
- **导入真实数据** — 从 OpenStreetMap 导入济南地铁线网（含在建/规划线路）

## 快速开始

### 在线使用

访问 [部署地址]（如有）直接使用。

### 本地运行

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### AI 功能配置（可选）

如需使用 AI 站点命名功能，需配置环境变量：

```bash
# .env.local
VITE_BLTCY_API_KEY=your_api_key_here
```

默认使用 `gemini-2.5-flash` 模型。

## 使用指南

### 基础操作

1. **新建工程** — 左侧工具栏 → 项目 → 新建工程
2. **绘制线路**：
    - 点站模式：点击地图添加站点
    - 拉线模式：点击两个站点连线
    - 连续布线：首次点击设起点，后续点击自动连线
3. **编辑线路** — 选中站点/线段后，右侧属性面板编辑名称、颜色、线型
4. **生成示意图** — 工具栏 → 工具 → 自动排版
5. **导出图片** — 工具栏 → 导出 → 选择导出格式
6. **排版控制** — 切换到版式视图（按 `2` 键），使用排版控制菜单调整显示样式

### 进阶功能

- **AI 点站** — 切换到 AI 点站模式，点击地图自动生成站名候选
- **批量重命名** — 选中多个站点 → 属性面板 → 批量重命名（支持 `{n}` 序号占位）
- **手动换乘** — 选中两个站点 → 工具栏 → 设为换乘
- **线段曲线** — 右键线段 → 在此加锚点 → 拖拽锚点调整曲线
- **导入真实数据** — 工具栏 → 项目 → 导入济南地铁（可选包含在建/规划）

### 快捷键

- `Delete` / `Backspace` — 删除选中对象
- `Ctrl/Cmd + A` — 全选站点
- `Ctrl/Cmd + Z` — 撤销
- `Ctrl/Cmd + Shift + Z` / `Ctrl/Cmd + Y` — 重做
- `Esc` — 取消选择 / 取消待连接起点
- `Shift/Ctrl/Cmd + 拖拽` — 框选站点/线段
- `Alt + 点击线段` — 选中整条线路

---

## 开发者文档

### 技术栈

- **前端框架** — Vue 3 + Vite
- **地图引擎** — MapLibre GL JS
- **状态管理** — Pinia
- **数据存储** — IndexedDB
- **AI 能力** — BLTCY API (gemini-2.5-flash)
- **地图数据** — OpenStreetMap / Overpass API

### 项目结构

```
src/
├── components/       # UI 组件
│   ├── MapEditor.vue           # 真实地图编辑器
│   ├── SchematicView.vue       # 官方风示意图视图
│   ├── SchematicControls.vue   # 版式排版控制菜单
│   ├── VehicleHudView.vue      # 车辆 HUD 视图
│   ├── ToolbarControls.vue     # 侧边栏工具栏
│   ├── map-editor/             # 地图编辑器子模块
│   ├── toolbar/                # 工具栏子组件
│   └── panels/                 # 属性面板子组件
├── composables/      # Vue 组合式函数
├── stores/           # Pinia 状态管理
│   └── project/                # 项目 store 模块化实现
│       ├── helpers.js          # 纯函数工具
│       └── actions/            # actions 按职责拆分
├── lib/              # 核心业务逻辑
│   ├── ai/                     # AI 命名能力封装
│   ├── osm/                    # OSM 导入链路
│   │   └── jinan/              # 济南导入实现
│   ├── hud/                    # 车辆 HUD 渲染模型
│   ├── schematic/              # 示意图渲染模型
│   ├── timeline/               # 时间轴动画引擎
│   ├── export/                 # 导出逻辑
│   ├── layout/                 # 布局 Worker 调用端
│   ├── storage/                # 本地存储
│   └── ranking/                # 全球排名计算
├── workers/          # Web Worker
│   └── layout/                 # 自动排版算法
└── data/             # 内置静态数据
```

详细说明见各目录下的 `README.md`。

### 核心模块说明

#### 地图编辑 (`src/components/MapEditor.vue`)

- 基于 MapLibre GL JS 的真实地图编辑器
- 支持站点点击/拖拽、线段绘制、锚点编辑
- 右键菜单、框选、键盘快捷键
- 逻辑已拆分至 8 个 composables（见 `src/composables/useMap*.js`）

#### 自动排版 (`src/workers/layout/`)

- 在 Web Worker 执行，避免阻塞主线程
- 地理锚定优先，保持原地理骨架
- 严格八方向规整、交汇扇出、交叉排斥
- 边最小长度硬约束、站点最小间距硬分离
- 算法已按职责拆分为 9 个模块

#### AI 命名 (`src/lib/ai/`)

- 两阶段生成：第一阶段生成中文站名，第二阶段翻译为英文
- 调用 BLTCY API（默认 `gemini-2.5-flash`）
- 支持单站点和批量接口
- 周边语义提取见 `src/lib/osm/nearbyStationNamingContext.js`

#### OSM 导入 (`src/lib/osm/jinan/`)

- 使用 Overpass API 查询济南市区域内地铁线路
- 支持在建/规划线路导入
- 环线自动识别
- 导入不覆盖当前工程，自动新建工程

#### 状态管理 (`src/stores/projectStore.js`)

- 工程生命周期、选择状态、网络编辑、历史记录
- actions 已按职责拆分为 12 个模块（见 `src/stores/project/actions/`）

### 数据模型

工程数据结构：

```javascript
{
  id: string,
  name: string,
  projectVersion: number,
  stations: [
    { id, nameZh, nameEn, lng, lat }
  ],
  edges: [
    { id, fromStationId, toStationId, lineId, waypoints, openingYear, lineStyleOverride }
  ],
  lines: [
    { id, nameZh, nameEn, color, status, lineStyle }
  ],
  manualTransfers: [[stationId1, stationId2]],
  layoutMeta: { stationLabels, edgeDirections },
  layoutConfig: {
    geoSeedScale,
    displayConfig: {
      showStationNumbers,
      showInterchangeMarkers,
      stationIconSize,
      stationIconStyle,
      showLineBadges,
      edgeWidthScale,
      edgeOpacity,
      cornerRadius,
    }
  },
  timelineEvents: [{ year, description }]
}
```

### 构建与部署

```bash
# 开发
npm run dev

# 构建
npm run build

# 预览构建产物
npm run preview
```

构建产物位于 `dist/` 目录，可部署到任意静态托管服务。

### 环境变量

```bash
# AI 功能（可选）
VITE_BLTCY_API_KEY=your_api_key_here

# Overpass API 配置（可选）
VITE_OVERPASS_MAX_CONCURRENCY=2
VITE_OVERPASS_MIN_INTERVAL_MS=1000
VITE_OVERPASS_MAX_RETRIES=3
```

### 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 许可证

[待补充]
