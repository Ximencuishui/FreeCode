# 贡献指南

欢迎为 FreeCoder 贡献！无论是 Bug 报告、功能建议、文档改进还是代码提交，我们都非常感谢。

## 开发环境

| 工具 | 版本要求 |
|------|---------|
| Node.js | 20+（推荐 22 LTS） |
| pnpm | 9+ |
| git | 任意现代版本 |

```bash
# 安装依赖
pnpm install

# 启动开发模式（Vite + Electron）
pnpm dev

# 常用命令
pnpm typecheck    # 类型检查
pnpm lint         # 代码规范（ESLint）
pnpm test:unit    # 单元测试（Jest）
pnpm test:e2e     # 端到端测试（Playwright + Electron，需先 pnpm build）
pnpm build        # 生产构建
pnpm package      # 打包安装包
```

## 提交规范

- 提交信息使用 Conventional Commits 风格：`feat:` / `fix:` / `test:` / `docs:` / `chore:` / `refactor:`
- 提交前 `pnpm lint` 与 `pnpm typecheck` 必须通过
- 单元测试 `pnpm test:unit` 必须通过（提交前可加 `--runInBand` 加速）
- git pre-commit 钩子会自动执行 lint-staged

## 代码结构

```
src/
├── main/          # Electron 主进程（窗口、IPC、存储、DSH 集成、预览、导出）
├── renderer/      # React 渲染进程（对话 UI、预览、导出面板）
├── preload/       # contextBridge 安全桥接
└── shared/        # 主/渲染进程共享类型与常量
tests/             # 单元测试（jest）与冒烟测试
e2e/               # 端到端测试（Playwright）
docs/              # 设计文档与调研
resources/         # 打包资源（图标、webview inspector 等）
```

## 贡献流程

1. Fork 仓库并创建特性分支
2. 提交改动（遵循提交规范）
3. 运行完整测试：`pnpm typecheck && pnpm lint && pnpm test:unit`
4. 发起 Pull Request，描述改动与验证结果

## 设计文档

详细设计见 `docs/` 目录与仓库根目录的设计文档（产品需求、技术架构、API 接口、数据库、前端设计、测试计划、开发计划）。
