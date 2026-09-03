# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
（patch 部分沿用仓库 `scripts/bump-version.mjs` 的两位数约定，例如 `0.1.01`、`0.1.02`）。

## [0.1.02] - 2026-09-03

0.1.01 之后的第一个 UX 修复版本，聚焦验收报告中的 **4 项 P0 + 7 项 P1，共 11 项缺陷**。
所有修复均经过单元 / E2E 测试覆盖，新增 33 个单元测试 + 4 条 E2E 路径，无破坏性变更。
详见 [`docs/RELEASE-0.1.02.md`](docs/RELEASE-0.1.02.md)。

### Fixed (P0)

- **P0-1 双输入框并存窗口期**：`AssistantPanel` 用 `useLayoutEffect` 同步派生 `shouldHideAiChat`，消除 AI 助理浮窗与 `ElementInspector` 内嵌 `MiniChat` 共存的渲染竞态。
- **P0-2 本地模式转换状态机断裂**：`convertToLocalMode` 主进程落地后立即清空 `versionPlan` 并触发 planner 重新生成；渲染端同步切回对话页并展示"正在生成版本分段计划…"。
- **P0-3 自动测试中断 banner 死循环**：引入指数退避（5s → 10s → 20s → 60s）与重试上限 3 次；新增 `autoTestRetryCount` / `incrementAutoTestRetry` / `resetAutoTestRetry`；修正 `resetAutoTestPlan` 误清零计数的回归 bug。
- **P0-4 部署助手"接管操作"假动作**：`handleTakeOver` 在无 `zipPath` 时拒绝执行 `onSuccess`，仅推送"差一份部署包"引导文案；fallback 阶段文案重构为"📋 一键接管准备清单"。

### Fixed (P1)

- **P1-1 右侧面板宽窄屏状态互通**：`App.tsx` 的 `useEffect` 依赖精简为 `[isNarrow]`，避免窄屏抽屉打开后被 effect 反向关闭。
- **P1-2 项目同名提示与实际行为不一致**：`FileStorageManager.createProject` 落地后 `dirToDisplayName` 反推 `meta.name`，与 `dir.basename` 严格同步。
- **P1-3 ProjectSwitcher 删除状态泄漏**：切换 / 新建项目时显式调 `setConfirmDeleteId(null)`，避免跨项目状态污染。
- **P1-4 ElementInspector 内嵌 MiniChat 不携带元素上下文**：`MiniChat` 新增 `elementContext?: ElementInfo` prop，`chat store.sendMessage` 签名扩展为 `sendMessage(text, options?)`，透传 `selectedElement` 给 DSH。
- **P1-5 删除按钮仅 hover 可见（无障碍缺陷）**：Tailwind class 改为 `opacity-0 group-hover:opacity-100 focus-within:opacity-100`，新增 `Delete`/`Backspace` 快捷键与 `aria-label`。
- **P1-6 项目切换未重置 `aiChatHidden`**：`chat store.setProject` 末尾同步调用 `useUiStore.getState().setAiChatHidden(false)`。
- **P1-7 窄屏浮动按钮位置错误**：窄屏下不渲染该浮动按钮（窄屏抽屉通过顶部按钮触发）。

### Added

- 新增组件 `src/renderer/components/Export/DeployView.tsx`、`src/renderer/components/Preview/InterruptBanner.tsx`、`src/renderer/components/common/ConfirmDialog.tsx`，及对应工具模块 `deployPanelUtils.ts` / `projectStatus.ts`。
- 新增 E2E 路径 `e2e/core-journey.spec.ts` 中的 4 条 P0/P1 回归用例（E2E-P0-2 / P0-3 / P0-4 / P1-4）。
- 新增 33 个单元测试（覆盖 convert-to-local-mode / auto-test-retry / deploy-assistant / right-panel-state / project-create-name / element-inspector-context）。

### Compatibility

- `chat:send` IPC 新增可选字段 `selectedElement`，向后兼容。
- `project:convert-to-local-mode` / `project:auto-test` IPC 返回结构不变，仅内部行为变化。
- `autoTestRetryCount` / `aiChatHidden` 为渲染层 in-memory state，跨视图持久但项目切换时主动重置。
- 历史项目 `meta.name` / `versionPlan` 不被改写，仅新建项目受 P1-2 / P0-2 影响。

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
