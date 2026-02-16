# components

UI 组件，负责交互与渲染。

## 根目录文件

- **App.vue** — 主布局容器（含左侧工具栏收起/展开状态持久化、工作区三视图"阶段化 Tab"切换状态持久化、页面关闭/刷新二次确认）
- **MapEditor.vue** — 基于 MapLibre 的真实地图编辑器（OSM 瓦片底图、站点点击/拖拽/加点/连线、AI 点站、连续布线、线段曲线渲染、锚点交互、框选、右键菜单、键盘快捷键）
- **ToolbarControls.vue** — 侧边栏主壳组件（品牌头部、主题/字体切换、编辑年份选择器、状态栏、当前上下文信息条、选项卡导航、动态子组件切换）
- **SchematicView.vue** — 渲染自动排版后的官方风示意图（地理主导示意图、滚轮缩放、中键平移）
- **SchematicControls.vue** — 版式视图排版控制菜单（站点显示、线路显示、布局参数的实时调整）
- **VehicleHudView.vue** — 车辆 HUD 视图（按线路 + 方向自动生成、线路/方向选择控件、换乘标识、方向箭头、环线双层闭合轨道、超长线折返）
- **TimelinePreviewView.vue** — 时间轴动画实时预览视图（Canvas 2D + requestAnimationFrame、播放控制、速度选择、全屏、伪"发展史"线序预览）
- **MenuBar.vue** — 顶部菜单栏（文件/编辑/视图/工具/帮助）
- **PropertiesPanel.vue** — 右侧属性面板容器（根据选中对象动态切换子面板）
- **TimelineSlider.vue** — 时间轴滑块控件（年份筛选、播放控制）
- **TimelineEventEditor.vue** — 时间轴事件编辑器
- **ProjectListDialog.vue** — 项目列表对话框
- **ConfirmDialog.vue** — 确认对话框
- **PromptDialog.vue** — 输入对话框
- **ToastContainer.vue** — Toast 通知容器
- **ErrorBoundary.vue** — 错误边界组件
- **StatusBar.vue** — 底部状态栏
- **ToolStrip.vue** — 工具条组件
- **AccordionSection.vue** — 手风琴折叠面板
- **DropdownMenu.vue** — 下拉菜单
- **TooltipWrapper.vue** — Tooltip 包装器
- **IconBase.vue** — 图标基础组件
- **IconSprite.vue** — 图标精灵表

## 子目录

- **map-editor/** — `MapEditor.vue` 的可复用子模块（纯函数与常量），详见 `map-editor/README.md`
- **toolbar/** — `ToolbarControls.vue` 的子组件（选项卡内容），详见 `toolbar/README.md`
- **panels/** — 属性面板子组件，详见 `panels/README.md`
