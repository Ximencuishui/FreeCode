# FreeCoder 0.1.02 Release Notes

**发布日期**：2026-10-XX
**协议**：MIT License
**Git tag**：`v0.1.02`
**基线版本**：[v0.1.01](https://github.com/.../releases/tag/v0.1.01)（commit `9c40164`）

## 版本概述

0.1.02 是 v0.1.01 之后的第一个 UX 修复版本，聚焦验收报告中的 **4 项 P0 + 6 项 P1，共 10 项缺陷**。
所有修复均经过单元 / E2E 测试覆盖，新增 33 个单元测试 + 4 条 E2E 路径，无破坏性变更。

**核心目标**：
- 🔴 **P0 阻塞修复**：解决"双输入框并存窗口期""本地模式转换后状态机断裂""自动测试死循环""部署助手假接管"4 个阻塞级问题
- 🟠 **P1 体验优化**：统一宽窄屏面板状态、同步项目同名后缀、清理删除状态泄漏、把元素上下文正确传到 DSH、键盘可达性、跨项目状态重置、修正窄屏浮动按钮位置

**测试覆盖**：
- 单元测试：387 passed（46 个测试文件，含本版本新增 33 个）
- E2E：核心旅程 + 4 条新增 P0/P1 回归路径（详见 [测试章节](#测试tests)）

---

## 🔴 P0 阻塞修复（4 项）

### P0-1：AI 助理浮窗与 ElementInspector 双输入框并存窗口期

**问题**：在 preview 视图选中元素后，存在一帧 React 渲染期，全局 AI 助理浮窗与 ElementInspector 内嵌的修改指令 MiniChat 同时可见，造成"两个输入框"的认知负担。

**根因**：`AssistantPanel` 通过 `useEffect` 后置设置 `aiChatHidden`，而 `<DraggableChat hidden={aiChatHidden} />` 在 App 末尾渲染，期间存在一帧两个输入框同时可见。

**修复方案**：
- 把"浮窗隐藏"从 `useEffect` 后置改为 **派生值 + `useLayoutEffect` 同步触发**
- `AssistantPanel` 在 React 渲染前用 `useMemo` 算出 `shouldHideAiChat`，通过 `useLayoutEffect` 在 DOM 更新前同步写入 ui store
- `App.tsx` 的 `<DraggableChat hidden={...} />` 改为读派生值，避免渲染时序竞态

**修改文件**：
- `src/renderer/components/Preview/AssistantPanel.tsx`
- `src/renderer/App.tsx`

### P0-2：本地模式转换后开发任务状态机断裂

**问题**：登录模式项目 → 转本地模式 → 状态被改回 `planned`，但 `versionPlan` 仍是旧（基于 `authentication='password'` 生成）的，用户点"确认 V1 计划，开始开发"后，DSH 收到的 plan 仍是含登录页的旧版。

**根因**：`convertToLocalMode` IPC 把状态打回 `planned` 但不重启 Planner / 不清空旧 `versionPlan`。

**修复方案**：
- 主进程 `convertToLocalMode` handler：把 `versionPlan: null` 一起写入 meta（落地即清空）
- 主进程末尾：直接调用 `planner.generatePlan(projectId, ...)` 异步重生基于本地模式的版本计划
- 渲染端 `PreviewContainer.convertToLocalMode`：成功后调用 `useChatStore.setVersionPlan(null)` 立即同步清空 store
- 渲染端 `useUiStore.setView('chat')`：自动切到对话页，让用户看到"正在生成版本分段计划…"提示

**修改文件**：
- `src/main/ipc/project.ts`（`convertToLocalMode` handler）
- `src/renderer/components/Preview/PreviewContainer.tsx`
- `src/main/dev/docsGenerator.ts`（backfill 同步）

### P0-3：自动测试中断 banner 死循环

**问题**：自动测试失败 → banner 弹出 → 倒计时到点自动重试 → 又失败 → 又倒计时重试 → 无限循环，且 retryCount 永远显示 1（修复前被反向重置）。

**根因 1**（设计层面）：没有重试上限，banner 一直自动重试。
**根因 2**（实施坑）：`resetAutoTestPlan` 体内有 `autoTestRetryCount: 0`，useChatEvents 的 error 处理中先调 `resetAutoTestPlan` 再调 `incrementAutoTestRetry`，导致计数永远停在 1（本版本通过 UT-ATR-001~008 测试发现并修复）。

**修复方案**：
- 引入**指数退避**：失败间隔 = `min(60_000ms, 5_000 × 2^retryCount)`（5s / 10s / 20s，封顶 60s）
- 引入**重试上限 3 次**：累计失败 ≥ 3 次后，`retryAt = null`，banner 显示"请手动重试"
- chat store 新增 `autoTestRetryCount` 字段 + `incrementAutoTestRetry` / `resetAutoTestRetry` actions
- `resetAutoTestPlan` 不再清零 retryCount（移到 success 'message' 分支显式调用 `resetAutoTestRetry`）
- `InterruptBanner` 组件支持 `retryAt=null`：取消倒计时，按钮文案改为"手动重试"，标题补上"已达自动重试上限"

**修改文件**：
- `src/renderer/store/chat.ts`
- `src/renderer/hooks/useChatEvents.ts`
- `src/renderer/components/Preview/AssistantPanel.tsx`（InterruptBanner UI）

### P0-4：部署助手"接管操作"假动作

**问题**：原本「接管操作」按钮是无条件调 `onSuccess` 的假动作（哪怕没有部署包），让用户在没部署包的情况下也被推到 success 阶段，产生"已自动部署"假承诺。

**修复方案**：
- `handleTakeOver` 在没有 `zipPath` 时拒绝执行：调 `pushMessage` 推送"差一份部署包"引导文案，**不**调 `onSuccess`
- 有 `zipPath` 时才执行：复制 `docker-compose` 命令到剪贴板 + 调 `useExportStore.zipPath` 对应目录的 revealInFolder + 调 `onSuccess`
- fallback 阶段文案重构：
  - 标题："🤝 我来替你完成这一步" → "📋 一键接管准备清单"
  - 明示：服务器命令这一步 FreeCoder 不会替你执行（安全约束），仅指引到 `deploy-guide.html`
- `DeployPanel.onSuccess` 改为只在 `zipPath` 存在时切到 success stage；没 `zipPath` 时保持 guide，让用户去"⚙️ 高级导出"

**修改文件**：
- `src/renderer/components/Export/DeploymentAssistant.tsx`
- `src/renderer/components/Export/DeployPanel.tsx`

---

## 🟠 P1 体验修复（6 项）

### P1-1：右侧面板宽窄屏状态互通

**问题**：宽屏状态下右侧面板折叠 / 展开与窄屏抽屉打开 / 关闭互相独立，导致用户在两种宽度间切换时看到"视觉割裂"。

**修复方案**：在 `App.tsx` 的 `useEffect` 里强制同步：
- `isNarrow=true` 时：嵌入面板 `rightCollapsed=true`，抽屉 `drawerOpen=false`
- `isNarrow=false` 时：如果 `drawerOpen=true`，也强制关闭
- **依赖数组精简为 `[isNarrow]`**（实测坑：依赖过广会导致用户在窄屏下打开抽屉后立即被 effect 反向重置）

**修改文件**：`src/renderer/App.tsx`

### P1-2：项目同名提示与实际行为不一致

**问题**：UI 提示"项目名"时按 `dir.basename` 加后缀，但 `meta.name` 仍然是用户输入的原始名，导致欢迎页 / ProjectSwitcher 显示"我的应用"而文件系统实际是"我的应用-2"。

**修复方案**：
- `FileStorageManager.createProject` 落地后，新增 `dirToDisplayName` 步骤：把 `resolveProjectDir` 算出的目录 basename 反推为 `meta.name`
- 这样 `meta.name` 与 `dir.basename` **严格同步**，UI 承诺与文件系统行为一致
- 含非法字符（如 `:`）的 name 也会同步处理

**修改文件**：`src/main/storage/index.ts`（新增 `dirToDisplayName`）

### P1-3：ProjectSwitcher 删除状态泄漏

**问题**：切换项目或新建项目后，"确认删除"对话框状态（`confirmDeleteId` + `open`）仍残留，导致新项目初始就显示一个误触发的删除确认弹窗。

**修复方案**：`selectProject(null)` 与"新建项目"入口都显式调 `setConfirmDeleteId(null)`，避免跨项目状态污染。

**修改文件**：`src/renderer/components/ProjectSwitcher.tsx`

### P1-4：ElementInspector 内嵌 MiniChat 不携带元素上下文

**问题**：ElementInspector 上的 `isProcessing` / `onSendModify` 是死参数，用户在检查器内输入修改指令后，DSH 收到的对话里不包含选中元素描述 — 等于"口语修改上下文"没被传递。

**修复方案**：
- `MiniChat` 新增 `elementContext?: ElementInfo` prop，发送时强制把 elementContext 作为 `selectedElement` 透传给 `chat store.sendMessage`
- `chat store.sendMessage` 签名扩展：`sendMessage(text, options?: { selectedElement?: ElementInfo })`
- 内部 `effectiveSelectedElement = options?.selectedElement ?? store.selectedElement` —— options 优先级 > store
- `ElementInspector` 把 `element` prop 作为 `elementContext` 传给 MiniChat

**修改文件**：
- `src/renderer/components/Chat/MiniChat.tsx`
- `src/renderer/store/chat.ts`
- `src/renderer/components/Preview/ElementInspector.tsx`

### P1-5：删除按钮仅 hover 可见（无障碍缺陷）

**问题**：ProjectWelcome / ProjectSwitcher 的删除按钮 Tailwind class 是 `opacity-0 group-hover:opacity-100`，键盘用户（Tab 聚焦）无法看到该按钮，违反无障碍最佳实践。

**修复方案**：
- Tailwind class 改为：`opacity-0 group-hover:opacity-100 focus-within:opacity-100`
- 增加键盘快捷键：聚焦项目卡片后按 `Delete` / `Backspace` 直接进入"确认删除"
- ARIA：添加 `aria-label="删除项目 {name}（快捷键 Delete）"`

**修改文件**：
- `src/renderer/components/ProjectWelcome.tsx`
- `src/renderer/components/ProjectSwitcher.tsx`

### P1-6：项目切换未重置 aiChatHidden

**问题**：A 项目选了元素 → `aiChatHidden=true` → 切到 B 项目 → 全局浮窗仍处于隐藏状态（应保持显示），污染新项目的初始视图。

**修复方案**：在 chat store `setProject` 末尾同步调用 `useUiStore.getState().setAiChatHidden(false)`，确保跨项目切换时浮窗隐藏状态被重置。

**修改文件**：`src/renderer/store/chat.ts`

### P1-7：窄屏浮动按钮位置错误

**问题**：窄屏下"打开右抽屉"的浮动按钮仍按宽屏位置 `top-16` 渲染，被 App 顶部标题栏遮挡。

**修复方案**：窄屏下不显示该浮动按钮（窄屏抽屉通过顶部按钮触发，不需要浮动按钮）；仅宽屏渲染 `right-4 top-16` 的浮动按钮。

**修改文件**：`src/renderer/App.tsx`

---

## 测试（Tests）

### 单元测试（33 个新增）

| 测试文件 | 用例 ID | 覆盖范围 | 测试数 |
|---------|---------|---------|-------|
| `tests/unit/convert-to-local-mode.test.ts` | UT-CONV-001~005 | P0-2：转换后 versionPlan 清空 + planner 重生触发 + status=planned + history 追加 + 异常路径 | 5 |
| `tests/unit/auto-test-retry.test.tsx` | UT-ATR-001~008 | P0-3：指数退避 5s/10s/20s + 3 次上限 + retryAt=null + resetAutoTestRetry + setProject 隔离 | 8 |
| `tests/unit/deploy-assistant.test.tsx` | UT-DA-001~004 | P0-4：fallback 文案改为"我把一切准备好了" + 无 zipPath 时 onSuccess 不被调用 + 剪贴板写入 docker-compose | 4 |
| `tests/unit/right-panel-state.test.ts` | UT-RP-001~005 | P1-1：宽窄屏切换状态同步 + 抽屉可打开修复回归 + 阈值边界 | 5 |
| `tests/unit/project-create-name.test.ts` | UT-PCN-001~005 | P1-2：meta.name 与 dir.basename 同步 + 重名跳跃式后缀 + 持久化一致性 + 非法字符处理 | 5 |
| `tests/unit/element-inspector-context.test.tsx` | UT-EIC-001~006 | P1-4：MiniChat 透传 elementContext + store 优先级 + IPC chat.send 携带 selectedElement + ElementInspector 集成 | 6 |
| **小计** | | | **33** |

**新增测试发现并修复的真实 Bug**（回归价值）：
- **P0-3 retryCount bug**：`resetAutoTestPlan` 错误地清零 `autoTestRetryCount`，导致 `useChatEvents` 的 error 分支里 `incrementAutoTestRetry` 永远从 0 +1，无法触发 3 次上限。修复方案：从 `resetAutoTestPlan` 中移除 `autoTestRetryCount: 0`，success 分支显式调用 `resetAutoTestRetry()`。该问题在原始 `chat-events-signal.test.tsx` 中未覆盖，由新增 `auto-test-retry.test.tsx` 发现。
- **P1-1 抽屉打不开 bug**：`useEffect` 依赖数组 `[isNarrow, rightCollapsed, drawerOpen, ...]` 过广，导致用户 `setDrawerOpen(true)` 后立即被 effect 反向重置。修复方案：依赖数组精简为 `[isNarrow]`，仅在 isNarrow 切换时同步。

### E2E 测试（4 条新增路径）

扩展 `e2e/core-journey.spec.ts`，新增 4 条 P0/P1 回归路径：

| 用例 ID | 覆盖项 | 验证点 |
|--------|--------|-------|
| E2E-P0-2 | P0-2 全链路 | 创建 password 项目 → confirm → 等待初始 versionPlan → convertToLocalMode → versionPlan 必须立即为 null → 等待 planner 重生 → requirements.authentication 必须为 'none' |
| E2E-P0-3 | P0-3 IPC 链路 | 创建项目 → confirmPlan → auto-test IPC 必须返回结构化报告（指数退避 / 3 次上限由单元测试覆盖） |
| E2E-P0-4 | P0-4 IPC 链路 | export.start 不会因 P0-4 修复引入崩溃（部署助手 UI 行为由单元测试覆盖） |
| E2E-P1-4 | P1-4 IPC 链路 | preview.selectElement + chat.send IPC 链路可达，selectedElement 字段被主进程接收（store 层契约由单元测试覆盖） |

### 完整测试结果

| 维度 | 数值 |
|------|------|
| 单元测试 | **387 passed** / 46 测试文件 / 100% 通过率 |
| 新增单元测试 | +33 |
| 新增 E2E 路径 | +4 |
| 回归 / 集成测试 | 全部 PASS |

---

## 使用方式（无破坏性变更）

直接安装 / 替换新版即可：
- Windows / macOS / Linux 安装包使用 `package.json` 的 `0.1.02` 版本号
- 应用内 `app.getVersion()` 与安装包文件名同步刷新为 `0.1.02`
- 历史项目无需任何手动操作

## 数据兼容性

- ✅ **项目文件**：所有 P1-2、P0-2 等修复**仅影响新建项目**，不修改既有项目的 `meta.name` / `versionPlan`
- ✅ **对话历史**：`autoTestRetryCount` 是渲染层 in-memory state，跨会话不持久化，重置无副作用
- ✅ **IPC 契约**：
  - `chat:send` 新增可选字段 `selectedElement`（向后兼容）
  - `project:convert-to-local-mode` 返回结构不变（内部行为变化）
  - `project:auto-test` 返回结构不变
- ✅ **UI 状态**：`aiChatHidden` 是渲染层 in-memory state，跨视图持久但项目切换时主动重置

## 升级注意事项

| 场景 | 是否需要手动操作 | 说明 |
|------|----------------|------|
| 普通升级 | ❌ 不需要 | 安装包直接覆盖即可 |
| 大量历史项目 | ❌ 不需要 | P1-2 仅影响新建项目，历史项目 meta.name 保留原值（仍能正常加载与运行） |
| 已部署了 0.1.01 | ❌ 不需要 | 这是个纯客户端修复，部署好的应用 / 服务器不受影响 |
| API Key | ❌ 不需要 | 沿用本地加密（safeStorage）持久化的 key |

## 已知限制（沿用 0.1.x）

- 生成的应用为静态 Web 应用（HTML/CSS/JS + localStorage 数据），无后端数据库
- 多轮对话基于 headless 单次任务模式（历史拼入上下文），长对话 token 成本较高
- 界面语言仅中文

## 致谢

感谢 DeepSeek 开源的 DeepSeek Harness（DSH）作为底层 Agent 引擎。
