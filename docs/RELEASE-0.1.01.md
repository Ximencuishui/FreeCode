# FreeCoder 0.1.01 Release Notes

**发布日期**：2026-09-02
**协议**：MIT License
**Git tag**：`v0.1.01`
**完整变更**：自 0.1.0 后的首个补丁版本，仅包含本次提交（commit `9c40164`）带来的变更。

## 版本概述

0.1.01 聚焦「项目文档 / 基础素材」工作区的可用性，并完成部署面板与包管理 IPC 的协同重构。
升级后，所有项目在需求确认、版本计划生成、或首次进入文档工作区时，都会自动获得结构清晰
的 `README.md` 与 `docs/*` 文件 —— 即便是升级前创建的历史项目也能立即看到内容，且不会
覆盖任何已存在的文件。

## 新增（Added）

- 📄 **项目文档自动补齐（WP-15）**：`docsGenerator` 在需求确认 / 版本计划生成 / 用户调整
  计划确认后，自动写入 `README.md`、`docs/requirements.md`、`docs/version-plan.md`，
  并刷新 README 里的「核心功能 / V1/V2」索引。
- 🖼️ **占位 logo 兜底**：开发完成时若 `assets/logo.svg` 缺失，主进程会写入一份占位 SVG，
  避免【文档】Tab 的「图片素材」分类永远为空。
- 📦 **包管理 IPC**：`src/main/package/` 模块与 `src/main/ipc/package.ts` 提供项目级
  导出 / 打包能力，与部署助手联动。
- 🤖 **AiAssistantIcon 通用图标**：被助手面板 / 部署助手 / 漂浮助手复用，统一视觉风格。

## 优化（Changed）

- 🛠️ **部署面板（DeployPanel / DeploymentAssistant）重构**：统一步骤卡片与操作反馈，
  步骤状态与包 IPC 联动，更符合「自助手」心智模型。
- 🧩 **AssistantPanel 微调**：与新图标、IPC 变更同步。

## 测试（Tests）

- 新增 `tests/unit/docs-generator.test.ts`，覆盖：
  - 需求确认 → 自动回填 `requirements.md` + `README.md`
  - 版本计划生成 → 写入 `version-plan.md` 并刷新 README 索引
  - `assets/logo.svg` 缺失 → 写入占位 SVG
  - **不覆盖**已存在的文件（回填逻辑的强制约束）

## 使用方式（无破坏性变更）

直接安装/替换新版即可：
- Windows / macOS / Linux 安装包使用 `package.json` 的 `0.1.01` 版本号
- 应用内 `app.getVersion()` 与安装包文件名同步刷新为 `0.1.01`
- 历史项目首次进入「文档」工作区时无需任何手动操作

## 已知限制（沿用 0.1.x）

- 生成的应用为静态 Web 应用（HTML/CSS/JS + localStorage 数据），无后端数据库
- 多轮对话基于 headless 单次任务模式（历史拼入上下文），长对话 token 成本较高
- 界面语言仅中文

## 致谢

感谢 DeepSeek 开源的 DeepSeek Harness（DSH）作为底层 Agent 引擎。
