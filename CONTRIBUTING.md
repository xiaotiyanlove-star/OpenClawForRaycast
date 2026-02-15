# Contributing to OpenClaw for Raycast

感谢你对 OpenClaw for Raycast 感兴趣！我们欢迎任何形式的贡献，包括提交 Bug、改进文档或提交代码。

## 开发环境搭建

1. **克隆仓库**
   ```bash
   git clone https://gitlab.com/xiaotiyan/raycast-openclaw.git
   cd raycast-openclaw
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动开发模式**
   ```bash
   npm run dev
   ```
   这将启动 Raycast 并加载你的本地扩展。

## 提交代码规范

- **Commit Message**: 请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。
  - `feat`: 新功能
  - `fix`: 修复 Bug
  - `docs`: 文档变更
  - `style`: 代码格式（不影响逻辑）
  - `refactor`: 代码重构
  - `perf`: 性能优化

- **代码风格**:
  - 本项目使用 ESLint + Prettier。
  - 提交前请运行 `npm run lint` 确保代码符合规范。
  - 使用 `npm run fix-lint` 自动修复格式问题。

## 发布流程

1. 更新 `package.json` 中的版本号。
2. 更新 `CHANGELOG.md`。
3. 提交 PR 到 `main` 分支。
