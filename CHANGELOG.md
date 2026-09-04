# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
（patch 部分沿用仓库 `scripts/bump-version.mjs` 的两位数约定，例如 `0.1.01`、`0.1.02`）。

## [Unreleased]

AI 助理引导式需求分析多行回复（"请选择：" + A/B/C/D/E 五个选项）被解析层
截断为单行「其他（告诉我具体是啥）」，用户看起来像 AI 没进入引导对话；
同步修复 stderr 调试回显被混入 reply 字符串导致的聊天历史污染。
49/49 测试套件、436/436 单元测试通过。

### Fixed

- **需求引导对话被截断为单行**（`src/main/dsh/service.ts`）：
  - 根因 1：`parseDshOutput` 在无 `<<<FC_*>>>` 信封标记时走 fallback 路径
    `extractLastReply(stdout)`，仅取最后一条非空行。227 字符的多行引导语
    （含"请选择："+ A/B/C/D/E 五个选项）被截断成 9 字符「其他（告诉我具体是啥）」。
    新增 `stripMarkerLines(stdout)` 工具函数（剔除空行 + `<<<FC_*>>>` marker
    噪音行，保留完整多行），`parseDshOutput` fallback 改用之。`extractLastReply`
    保留为独立工具函数。
  - 根因 2：`runTask` 的 `output` 累积未区分 stdout/stderr，把 stderr 调试回显
    （如 `[FakeDSH] profile=... task=...`）也吃进 reply 字符串并写入聊天历史。
    改为 `if (o.stream === 'stdout') output += o.data`，stderr 仅实时转发给
    `onProgress` 用于进度渲染，不再混入 reply。
  - 配套：`tests/unit/dsh-service.test.ts` 取消「只取最后一行」错误预期，
    新增 3 个守护用例（含 1 个端到端 `runTask` 需求分析多行回归）。
  - `tests/unit/fixtures/fake-dsh.js`：`[FakeDSH] profile/task` 回显从
    stdout 迁到 stderr，与主代码改动保持一致。

### Added (UI)

- **DraggableChat 顶部 resize handle**（`src/renderer/components/Chat/DraggableChat.tsx`）：
  v0.1.07 用户请求，沿顶部 6px 边缘可上下拉伸窗口；`startDrag` 已支持
  `'n'` 方向，与现有 nw/ne 角 handle 共享 8px 边界避免行为跳变。

## [0.1.09] - 2026-09-04

dsh 运行时状态机改造（方案 3 落地）。状态栏右下角徽章从「⚠ 未检测到 dsh」一档细化为 6 档：
loading（IPC 往返骨架）/ idle（休眠中）/ starting / running / stopping / error / missing。
所有改动向后兼容，已通过 425 个单元测试 + 新增 7 个状态机用例。

### Added

- **dsh 实时状态机**：DSHService 继承 EventEmitter，新增 `getState()` / `onStateChange()` /
  `computeState()` / `notifyStateChanged()`；多 manager 并发时按优先级聚合（error >
  stopping > running > starting > idle > loading）。
- **dsh:state IPC 通道**（`dsh:state` invoke 拉快照，`dsh:state-change` 主进程→渲染层推流）。
  详见 `src/main/ipc/dsh.ts`、`src/main/ipc/index.ts`。
- **preload 暴露 `window.electron.dsh.{state, onStateChange}`**（`src/preload/index.ts`）。
- **`useDshState` React hook**（`src/renderer/hooks/useDshState.ts`）：mount 时拉一次快照 +
  订阅增量变化，cleanup 取消订阅。
- **`<DshStatusBadge>` 状态栏徽章**（`src/renderer/components/DshStatusBadge.tsx`）：
  5 种视觉态（loading/idle/active/error/missing）+ title 悬浮提示。
- **DSHRunStatus 类型 + DSHRunStatus 'loading' 分支**（`src/shared/types/dsh.ts`）：
  渲染层 INITIAL 用 loading，避免 IPC 往返期间误显示"已就绪"。

### Fixed

- **dev 态下 dsh 内置运行时目录探测**：原 `getResourcesPath()` 两条候选路径深度不一致，
  vite 编译到 `dist/main/dsh/service.js` 时第二条才命中。统一为「`__dirname/../../../resources`」
  + 「`process.cwd()/resources`」兜底，覆盖源码态 / 编译态 / monorepo 子目录三种启动方式。
- **状态栏文案「休眠中」**：之前 idle 提示文案是"已就绪 · 按需启动"，与「dsh 是按需启动」的语义
  区分不清。统一为「休眠中」，徽章图标从 ✓ 改为 💤。
- **DSHService 状态推送的语义 race**：原 `runTask` 顺序是 `manager.start() → add + on + notify`，
  `manager.start()` 是同步 spawn，会先 setStatus('starting') 再 setStatus('running')，监听器
  没挂上就收不到这两帧，徽章的 `case 'starting'` 永远见不到。改为「先 add + on，再 start()」；
  监听器中遇到 stopped/idle 终态立刻 off + delete，避免聚合状态出现「status=stopped 但
  busyCount=1」的脏快照。
- **状态栏 INITIAL 与真实 missing 状态语义冲突**：INITIAL 之前是 `available: true, status: 'idle'`
  + 提示「DSH 状态加载中…」，缺 dsh 用户的首屏会闪一下"假装就绪"。改为
  `available: false, status: 'loading'`，徽章在 loading 期间显示骨架态而非误导。
- **computeState() 与 checkHealth() 的 missing 文案漂移**：原 computeState 写"启动入口"、
  checkHealth 写"运行时"，用户视觉像两条独立告警。统一为模块常量
  `MISSING_LAUNCH_MESSAGE = '未检测到 DeepSeek Harness（dsh）启动入口'`。

### Changed (Cleanup)

- **`AppInfo` 删除 dshVersion / dshAvailable / dshHint 三个死字段**（`src/shared/types/app.ts`），
  ipc/app.ts 不再接受 dsh 参数、不再每调用执行 `dsh.checkHealth()` 涉及文件系统 IO。
- **DshStatusBadge / App.tsx 头注释与代码同步**：原注释引用「✓ 已就绪 · 按需启动」与实际
  渲染的「💤 休眠中」不一致，统一修正。
- **7 个状态机单元测试**（`tests/unit/dsh-service.test.ts`）：守住 getState / onStateChange /
  activeManagers 生命周期 / 状态去重 / missing 文案常量复用。
- **DSH 内置运行时漏装根因修复（构建链路 + CI 一体化）**：
  - 背景：FreeCoder 0.1.0 ~ 0.1.5 全系列安装包均漏 `resources/dsh/`（dsh 全家桶 333.8 MB，
    electron-builder 找不到源目录就跳过），终端用户装上看到底部状态栏 `⚠ dsh 引擎未找到`。
    `release/win-unpacked/resources/` 验证：dsh/ 缺失，但 node/ app-runtime/ icons/ preview/ 都在。
  - `package.json` `scripts`：原 `pnpm package` 不调 `pnpm bundle:dsh`。`build` 改为
    `pnpm typecheck && pnpm bundle:dsh && vite build`，`package` 通过 build 间接包含 bundle
    —— 强制保证最终安装包含 dsh 运行时。
  - `scripts/bundle-dsh.mjs`：多候选源解析（`DSH_PACKAGE_ROOT` 环境变量 > 项目
    `node_modules` > `G:\DSH` 兜底），全部失败时列出三个候选 + 三种解决方式后 `exit 1`，
    而非静默继续产出无 dsh 安装包。同时把"覆盖 .gitkeep"的副作用改为"只缺失时创建"
    避免 git status 噪声。
  - `.github/workflows/ci.yml` 新增 `release-windows` job（windows-latest 跑
    `pnpm package`，通过 `DSH_BUNDLE_ARCHIVE_B64` secret 注入完整 dsh bundle 归档）；支持
    `workflow_dispatch` 手工触发 + `publish=true` 自动发 GitHub Release。
  - `CONTRIBUTING.md` 新增「发布打包前置」一节：本地打包步骤、CI DSH bundle 三种 secret
    替代方案（GitHub Packages / 制品库 / `actions/cache@v4`），帮助仓库管理员避 secret 64 KB
    体积上限问题。

### Fixed

- **底部状态栏 API 配置文字按三态切色**（`src/renderer/App.tsx`）：原 `<footer>` 父级
  `text-slate-400` 覆盖了内部文字色，让「已配置」「未配置」「加载中」视觉一致、无法传递
  状态。改按 `apiKeyConfigured` 三态切 `text-emerald-600` / `text-amber-600` /
  `text-slate-400`，跟 921 行那个圆点按钮配色一致。
- **dsh 缺失徽章文案简化**（`src/main/dsh/service.ts`）：原文案"未检测到 DeepSeek Harness
  （dsh）启动入口（未找到 dsh 命令，也未检测到内置运行时）"含"启动入口"/"内置运行时"两个
  开发者黑话、连用三个否定句、对非技术用户不可读；"在系统中安装 dsh 命令"还跟产品承诺
  "自带 dsh"矛盾。简化为「dsh 引擎未找到（请重新安装 FreeCoder）」。
- **dsh-service 状态机测试断言同步**（`tests/unit/dsh-service.test.ts`）：`MISSING_LAUNCH_MESSAGE`
  字面量改为 `'dsh 引擎未找到'`，匹配模式收紧到带前后单引号（避免文档注释干扰计数）。
  42/42 单元测试通过。

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
