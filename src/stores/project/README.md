# stores/project 目录说明

该目录是 `projectStore` 的模块化实现。

- `helpers.js`
  - 地图编辑相关纯函数（站点去重、模板命名、线段锚点点序修正、插点定位等）
- `actions/`
  - Store action 拆分目录
  - 详见 `actions/README.md`

约定：

- 子模块 action 统一依赖 `this`（Pinia store 实例）
- 不改变 `projectStore` 的行为与调用方式
