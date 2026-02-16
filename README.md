# Metro Studio

<img width="2077" height="1083" alt="image" src="https://github.com/user-attachments/assets/e2cbb6b0-050e-4fc8-a673-2b84322bd5ea" />


[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)

在真实地图上轻松绘制专业的地铁线路图。

## 什么是 Metro Studio

Metro Studio 是一个地铁线路图编辑器，专为轨道交通爱好者设计。你可以在 OpenStreetMap 地图上绘制地铁线网，自动生成官方风格的示意图，并导出为图片或视频。

## 核心功能

**地图编辑**

在真实地图上点击添加站点、拖拽连线、绘制线路。支持框选、多选、批量编辑。

**自动排版**

一键生成八方向规整的地铁示意图，算法自动优化线路布局。

**多视图展示**

- 地图视图：真实地理位置编辑
- 示意图视图：官方风格线路图
- 车载 HUD 视图：模拟车辆显示屏
- 时间线视图：线网发展历程动画

**导出与分享**

导出 PNG 高清图片、时间线动画视频、项目数据文件。

**AI 辅助**

根据站点周边地理信息，自动生成中英文站点名称。

**数据导入**

从 OpenStreetMap 导入真实的地铁线网数据。

## 快速开始

### 在线使用

[在线演示地址（计划部署中）]

### 本地运行

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### AI 功能配置

1. 打开菜单栏 → 设置 → AI 配置
2. 填写 API Base URL（支持 OpenAI 兼容 API）
3. 填写 API Key
4. 保存配置

## 快捷键

- `Delete` / `Backspace`：删除选中对象
- `Ctrl/Cmd + A`：全选站点
- `Ctrl/Cmd + Z`：撤销
- `Ctrl/Cmd + Shift + Z`：重做
- `Esc`：取消选择
- `Alt + 点击线段`：选中整条线路

## 技术栈

Vue 3 · Pinia · MapLibre GL JS · OpenStreetMap

## 贡献

欢迎贡献代码、报告问题或提出建议。详见 [贡献指南](CONTRIBUTING.md)。

## 许可证

GPL-3.0 License · 详见 [LICENSE](LICENSE)
