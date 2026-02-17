# 贡献指南

感谢你对 Metro Studio 项目的关注。我们欢迎任何形式的贡献，包括代码提交、问题报告、功能建议、文档改进等。

## 开发流程

1. Fork 仓库到你的 GitHub 账号
2. Clone 你的 Fork：`git clone https://github.com/your-username/railmap.git`
3. 创建新分支：`git checkout -b feature/your-feature-name`
4. 进行开发
5. 提交更改：`git commit -m "feat: 描述你的更改"`
6. 推送并创建 Pull Request

## 分支命名

| 前缀 | 用途 |
|------|------|
| `feature/` | 新功能 |
| `fix/` | Bug 修复 |
| `refactor/` | 代码重构 |
| `docs/` | 文档更新 |

## 提交信息格式

```
<类型>: <简短描述>
```

类型：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `chore`

## 代码规范

- 使用 Vue 3 Composition API + `<script setup>`
- 组件文件使用 PascalCase 命名
- 函数保持单一职责，避免深层嵌套
- 复杂逻辑添加必要注释

## 提交前检查

```bash
npm run build
```

确保代码通过构建、文档已更新、PR 描述清晰。

## 许可证

贡献代码即同意遵循项目的 GPL-3.0 许可证。
