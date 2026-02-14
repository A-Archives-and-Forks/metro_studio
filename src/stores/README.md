# stores 目录说明

该目录存放 Pinia Store。

- `projectStore.js`
  - Store 入口与聚合层（state/getters/actions 组合）
  - 通过对象展开整合 `project/actions/*`
- `project/`
  - `helpers.js`：站点/线段编辑通用工具函数
  - `actions/`：按职责拆分的 action 子模块
  - 详见 `project/README.md`

`projectStore` 对外 API（`useProjectStore`）保持不变。
