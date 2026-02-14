# lib/storage 目录说明

该目录负责工程持久化与文件读写。

- `db.js`
  - IndexedDB 初始化（`railmap-db`）
  - 工程保存、加载、列表、删除、最近项目指针
  - 保存前执行可序列化投影（去响应式代理，规整数值/数组）
  - 持久化布局结果与参数（`layoutMeta`、`layoutConfig.geoSeedScale`）
  - 持久化手动换乘关系（`manualTransfers`）
- `projectFile.js`
  - 工程 JSON 序列化
  - 本地下载 `.railmap.json`
  - 解析导入文件并标准化为内部模型

存储对象：

- `projects`：工程主体数据
- `meta`：全局元信息（最近工程 ID）
