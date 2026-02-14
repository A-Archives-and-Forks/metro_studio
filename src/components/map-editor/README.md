# components/map-editor 目录说明

该目录存放 `MapEditor.vue` 的可复用子模块：

- `constants.js`
  - 图层/数据源标识常量与曲线分段参数
- `mapStyle.js`
  - MapLibre 底图样式定义
- `dataBuilders.js`
  - 真实地图导出与渲染所需纯函数
  - 包含边界/站点/线段/锚点 GeoJSON 构建
  - 包含线段点序校正、曲线插值、工程边界统计、导出文件名清洗

约束：

- 仅包含纯函数与常量，不持有组件状态。
