# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
（patch 部分沿用仓库 `scripts/bump-version.mjs` 的两位数约定，例如 `0.1.01`、`0.1.02`）。

## [0.1.01] - 2026-09-02

首个正式条目。仅记录自上次发布标签以来最具代表性的提交，具体历史请参见 `git log`。

### Added

- WP-15 项目文档 / 基础素材生成器（`src/main/dev/docsGenerator.ts`）：根据需求确认、版本计划自动回填 `README.md`、`docs/requirements.md`、`docs/version-plan.md`，并为首次进入文档工作区的历史项目自动补齐缺失文件（永远不覆盖用户已存在的内容，先 `stat` 后写入）。
- 占位 logo 兜底：开发完成（`developer.startDevelopment onDone`）时若 `assets/logo.svg` 缺失，自动写入占位 SVG，确保「图片素材」分类不再为空。
- 项目包管理 IPC：`src/main/package/`（`service.ts` + `shell-template.ts`）与 `src/main/ipc/package.ts` 提供项目级导出 / 打包能力，与部署助手联动。
- `AiAssistantIcon` 通用图标组件（`src/renderer/components/AiAssistantIcon.tsx`），供助手面板 / 部署助手 / 漂浮助手共用。
- 单元测试 `tests/unit/docs-generator.test.ts`：覆盖 `README.md` / `docs/*` 自动补齐与占位资产写入逻辑。

### Changed

- `src/renderer/components/Export/DeployPanel.tsx`：重构步骤卡片、状态反馈与包 IPC 对接（+340 行 / −部分）。
- `src/renderer/components/Export/DeploymentAssistant.tsx`：与 `DeployPanel` 同步重整，统一操作反馈（+225 行 / −部分）。
- `src/renderer/components/Preview/AssistantPanel.tsx`：跟进新图标与 IPC 变更。
- `src/main/ipc/{app,index,project}.ts`、`src/preload/index.ts`、`src/shared/types/{electron.d.ts,ipc.ts}`：补齐 `package.*` / `deploy.*` IPC 与 preload 桥接。
- `package.json` 版本号由异常的 `0.1.00` 修正为 `0.1.01`。

### Compatibility

- 不破坏现有 IPC 契约；新增 IPC 字段均为可选。
- 用户文档、资产文件均为「按需补齐」，不会改写任何已存在文件。
