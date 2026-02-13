# lib/schematic 目录说明

示意图渲染模型层，用于统一“界面预览”和“文件导出”的视觉语义与几何处理。

- `renderModel.js`
  - `buildSchematicRenderModel(project, options)`：
    - 读取 `stations / edges / lines / layoutMeta`
    - 生成官方风视图所需的渲染模型（背景、线路路径、站点标签）
    - 处理共线偏移、圆角折线、线路状态透明度
    - 支持 `options.mirrorVertical`：按画布中心执行上下镜像（会同步镜像标签纵向偏移，避免文字倒置）
  - 目标：保证 `SchematicView.vue` 与 `exportSchematic.js` 输出一致，避免双份逻辑漂移。
