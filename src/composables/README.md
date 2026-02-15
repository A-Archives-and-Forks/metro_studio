# composables

Vue 3 Composition API composables，封装可复用的组件逻辑。

## 文件说明

### 地图编辑器相关
- **useMapContextMenu.js** — 右键菜单状态、位置调整、所有 `*FromContext` 操作函数
- **useMapAiStationMenu.js** — AI 站点命名菜单状态、候选请求/应用、abort 控制
- **useMapLineSelectionMenu.js** — 线路选择菜单状态、选择逻辑
- **useMapExport.js** — PNG 导出全流程（`exportActualRoutePngFromMap` 及辅助函数）
- **useMapEventHandlers.js** — 点击/拖拽/键盘/鼠标事件处理、`dragState`/`anchorDragState`/`selectionBox` 状态
- **useMapBoundary.js** — 边界哈希、`fitMapToBoundary`、边界 watcher
- **useRouteDrawPreview.js** — 连续布线预览状态、距离计算、颜色渐变
- **useMapTimelinePlayer.js** — 时间轴播放器生命周期管理

### 工具栏相关
- **useToolbarProjectManagement.js** — 项目列表、创建/加载/重命名/复制/删除、文件导入
- **useToolbarUiPreferences.js** — 主题/字体切换、localStorage 持久化
- **useToolbarStationOps.js** — 站点表单、重命名、批量重命名、删除、全选
- **useToolbarEdgeOps.js** — 线段批量表单、线段属性更新、线路重分配
- **useToolbarLineOps.js** — 线路表单、增删改
- **useToolbarEditYear.js** — 年份输入、规范化、增减

### 其他视图相关
- **useMenuBarActions.js** — 菜单项定义（5 个 computed 菜单结构）、action 分发、城市预设过滤
- **useViewportControl.js** — 缩放/平移/鼠标事件、viewport transform 计算（用于 VehicleHudView）
- **useTimelinePlayback.js** — 播放控制（play/pause/stop/speed）、renderer 生命周期、全屏（用于 TimelinePreviewView）

### 通用工具
- **useAiAutoBatchNaming.js** — AI 批量站点命名流程（进度追踪、错误处理、abort 控制）
- **useAutoSave.js** — 自动保存节流与状态管理
- **useDialog.js** — 全局对话框状态管理（confirm/prompt）
- **useToast.js** — Toast 通知状态管理
- **usePanelResize.js** — 面板拖拽调整尺寸
- **useWorldMetroRanking.js** — 全球轨道交通排名数据获取与计算
