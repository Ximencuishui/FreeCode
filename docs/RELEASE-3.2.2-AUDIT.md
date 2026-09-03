# v3.2.2 验收报告：本轮 5 项遗留修复审计

> 审计对象：v3.2.2 验收中残留的 **P0-5 后台任务取消** / **P1-13 链接降级 title** / **P1-14 图片点击放大** / **P1-15 ConfirmDialog 焦点恢复** / **P2-19 SaveLocationDialog 迁原生 dialog** 共 5 项修复。
> 审计人：Qoder（v3.2.2 第 6 轮会话延续）
> 日期：2026-09-02

## 0. 验证基线

| 项目 | 状态 | 备注 |
|---|---|---|
| `pnpm typecheck` | ✅ PASS | main + renderer 双配置均通过 |
| `pnpm lint` | ✅ 0 errors | 9 warnings 全部预先存在（与本轮无关） |
| `pnpm test` | ✅ **391/391 passed** | 46/46 test suites |

## 1. 变更清单（17 个文件）

### 1.1 P0-5 后台任务取消（12 文件）

| 层 | 文件 | 关键改动 |
|---|---|---|
| main/service | [developer.ts](file:///e:/FreeCoder/src/main/dev/developer.ts) | `activeControllers: Map<projectId, AbortController>` + `cancel(projectId)` |
| main/service | [service.ts (export)](file:///e:/FreeCoder/src/main/export/service.ts) | `activeControllers` + `throwIfCancelled()` + `ExportCancelledError` |
| main/service | [service.ts (package)](file:///e:/FreeCoder/src/main/package/service.ts) | `currentByProject: Map<projectId, ChildProcess>` + `cancel(projectId)` SIGTERM |
| shared/types | [ipc.ts](file:///e:/FreeCoder/src/shared/types/ipc.ts) | 新增 `projectCancelDevelopment` / `exportCancel` / `packageCancel` 三个通道 |
| shared/types | [electron.d.ts](file:///e:/FreeCoder/src/shared/types/electron.d.ts) | 暴露 3 个 `cancel` API + `ExportCompleteEvent.status` 加 `'cancelled'` |
| shared/types | [export.ts](file:///e:/FreeCoder/src/shared/types/export.ts) | `ExportCompleteEvent.status` 类型扩展 |
| main/ipc | [project.ts](file:///e:/FreeCoder/src/main/ipc/project.ts) | `cancelDevelopment` handler（977 行后追加） |
| main/ipc | [export.ts](file:///e:/FreeCoder/src/main/ipc/export.ts) | `ExportCancelledError` 分支广播 status='cancelled' + `exportCancel` handler |
| main/ipc | [package.ts](file:///e:/FreeCoder/src/main/ipc/package.ts) | `packageCancel` handler |
| preload | [index.ts](file:///e:/FreeCoder/src/preload/index.ts) | 暴露 `cancelDevelopment` / `export.cancel` / `package.cancel` |
| renderer/store | [chat.ts](file:///e:/FreeCoder/src/renderer/store/chat.ts) | `cancelActiveTasks(projectId)` 并发调 3 个 cancel + allSettled |
| renderer/store | [export.ts](file:///e:/FreeCoder/src/renderer/store/export.ts) | `handleExportComplete` 接 `cancelled` 分支 |
| renderer/app | [App.tsx](file:///e:/FreeCoder/src/renderer/App.tsx) | `prevProjectIdRef` + useEffect 监听 currentProjectId 切项目时调 cancelActiveTasks |

### 1.2 P1-13 链接降级 title（1 文件）

- [DocumentMarkdown.tsx](file:///e:/FreeCoder/src/renderer/components/Documents/DocumentMarkdown.tsx)：新增 `describeLinkProtocol(url)` 推断协议标签，降级 `<span>` 加 title 提示

### 1.3 P1-14 图片点击放大（1 文件）

- [DocumentMarkdown.tsx](file:///e:/FreeCoder/src/renderer/components/Documents/DocumentMarkdown.tsx)：模块级 `fullscreenOpenerRef` + 图片改 `<button>` 触发全屏弹层（fixed 遮罩 + Esc + 自然 `<img>` 渲染）

### 1.4 P1-15 ConfirmDialog 焦点恢复（1 文件）

- [ConfirmDialog.tsx](file:///e:/FreeCoder/src/renderer/components/common/ConfirmDialog.tsx)：`triggerRef + wasOpenRef` 实现开/关焦点记录与还原

### 1.5 P2-19 SaveLocationDialog 迁原生 dialog（2 文件）

- [SaveLocationDialog.tsx](file:///e:/FreeCoder/src/renderer/components/SaveLocationDialog.tsx)：`<dialog>` + useRef + showModal/close + close 事件桥接 onCancel + 防御性 typeof
- [save-location-dialog.test.tsx](file:///e:/FreeCoder/tests/unit/save-location-dialog.test.tsx)：mock `HTMLDialogElement.showModal/close` 模拟 Chromium 行为

## 2. 发现项（8 项，按优先级）

### 🔴 P0-5-1 切项目后聊天流误报"任务已被中断"（P0）

**现象**：用户切项目时触发 Developer.cancel → controller.abort → DSH runTask 抛 `DSHError('TASK_CANCELLED', '任务已被中断')` → Developer catch 分支 → `finish({success: false, message: '任务已被中断'})` → IPC 层 onDone 回调 → `broadcastSignal({type: 'error', message: '任务已被中断'})` → 渲染层 [useChatEvents.ts:144-211](file:///e:/FreeCoder/src/renderer/hooks/useChatEvents.ts#L144-L211) `onSignal` → pushMessage 红字系统消息「⛔ 任务已被中断」。

**问题**：
1. 用户主动切项目（or 系统主动 cancel）不应给用户弹"任务已被中断"的红色 error 提示。
2. 与 `chat:send` IPC handler 已有的 `TASK_CANCELLED` 静默成功路径（[chat.ts:112-114](file:///e:/FreeCoder/src/main/ipc/chat.ts#L112-L114)）不一致。

**建议修复**：
- 在 [developer.ts:147-152](file:///e:/FreeCoder/src/main/dev/developer.ts#L147-L152) 的 catch 分支识别 TASK_CANCELLED：
  ```ts
  if (error instanceof DSHError && error.code === 'TASK_CANCELLED') {
    finish({ projectId, success: true, message: '任务已取消', durationMs: Date.now() - started });
    return;
  }
  ```
- 或者更彻底：TASK_CANCELLED 时直接 return，不调 finish（因为 success: true 也会广播 info，与"主动取消"语义不符）。

### 🟠 P0-5-2 打包取消无 SIGKILL 兜底（P1）

**现象**：[package/service.ts:78-83](file:///e:/FreeCoder/src/main/package/service.ts#L78-L83) `cancel(projectId)` 仅 `child.kill('SIGTERM')`。electron-builder 接到 SIGTERM 可能不退出（其本身可能 fork 子进程继续打包）。

**影响**：用户切项目时打包任务长时间不退出，资源占用 + 后台进程残留。

**建议修复**：
- 监听 SIGTERM 5 秒内未退出 → escalate 为 SIGKILL
- 或者调用 `tree-kill` 杀整个进程组（Windows 上用 `taskkill /F /T /PID <pid>`）

### 🟠 P1-14-1 fullscreenOpenerRef 多实例冲突风险（P1）

**现象**：[DocumentMarkdown.tsx:27-31](file:///e:/FreeCoder/src/renderer/components/Documents/DocumentMarkdown.tsx#L27-L31) 模块级 ref `fullscreenOpenerRef` 是单例。如果同时挂两个 DocumentMarkdown 实例（未来支持多文档分屏），最后挂的实例会覆盖前者。

**当前状态**：DocumentMarkdown 只有 DocumentViewer 一处使用，单实例，问题不暴露。

**建议修复**：在组件 unmount 时把 ref.current 还原为 noop：
```tsx
useEffect(() => {
  return () => {
    fullscreenOpenerRef.current = () => { /* noop */ };
  };
}, []);
```

### 🟠 P1-14-2 图片全屏弹层 keyboard focus 未管理（P1）

**现象**：[DocumentMarkdown.tsx:554-588](file:///e:/FreeCoder/src/renderer/components/Documents/DocumentMarkdown.tsx#L554-L588) 全屏弹层 `tabIndex={-1}` 但 mount 后没有 `autoFocus`，键盘用户必须先 Tab 到 dialog 区域才能按 ESC 关闭。

**建议修复**：
- 加 `useEffect(() => { if (fullscreen) divRef.current?.focus(); }, [fullscreen])`
- 或者用原生 `<dialog>` 元素（与 P2-19 风格统一，自动 focus trap）

### 🟠 P1-15-1 SaveLocationDialog StrictMode 下 triggerRef 覆盖（P1）

**现象**：[SaveLocationDialog.tsx:58-71](file:///e:/FreeCoder/src/renderer/components/SaveLocationDialog.tsx#L58-L71) mount effect 在 React StrictMode 下双跑：
1. 第一次 mount：记录触发按钮 + showModal
2. unmount（StrictMode 模拟）：dialog.close()
4. 第二次 mount：`document.activeElement` 已是 dialog 自身 → `triggerRef.current = dialog` → 关闭时 focus dialog（已卸载）失败

**建议修复**：用 wasMountedRef 标记"是否首次挂载"：
```tsx
const wasMountedRef = useRef(false);
useEffect(() => {
  if (wasMountedRef.current) return; // 第二次 mount 不再覆盖
  wasMountedRef.current = true;
  // ... 记录 trigger + showModal
}, []);
```

### 🟡 P1-15-2 ConfirmDialog 无单元测试（P2）

**现象**：[ConfirmDialog.tsx](file:///e:/FreeCoder/src/renderer/components/common/ConfirmDialog.tsx) 加了焦点恢复逻辑（影响 PreviewContainer / RequirementCard 两处调用方的键盘体验），但没有单元测试。

**建议**：补一个 `tests/unit/confirm-dialog.test.tsx`：
- 打开弹窗 → 关闭弹窗 → 焦点回到 trigger
- 弹窗内点击按钮 → 关闭弹窗 → 焦点仍回到原 trigger（不是弹窗内按钮）
- ESC 关闭 → 焦点回到 trigger

### 🟡 P1-13 + P1-14 无单测（P2）

**现象**：[DocumentMarkdown.tsx](file:///e:/FreeCoder/src/renderer/components/Documents/DocumentMarkdown.tsx) 链接降级 title / 全屏弹层没有单测。

**建议**：补 `tests/unit/document-markdown.test.tsx`：
- 渲染含 `![alt](file:///path/to/img)` 的 markdown → 找到 `<button>` with title="点击查看大图"
- 点击图片 → 渲染全屏弹层 → 渲染 `<img src="file:///...">`
- ESC 关闭 → 弹层消失

### 🟡 P0-5-3 后台取消 service 缺单测（P2）

**现象**：Developer / ExportService / PackagerService 的 cancel 方法没有单元测试。

**建议**：补 3 个 service 级 cancel 测试：
- Developer.cancel：未注册返回 false；已注册返回 true；二次 cancel 返回 false
- ExportService.cancel：同 Developer
- PackagerService.cancel：child.kill('SIGTERM') 被调用（mock spawn）；无 child 返回 false

## 3. 设计观察（无 bug，仅记录）

1. **PackagerService start 时已有并发防护**：检查 `currentByProject.has(projectId)` → 抛 IpcError，避免同项目并发打包。但不同项目的并发打包允许。
2. **ExportService 没有 cancel in-flight 限制**：`startExport` 不检查 activeControllers，可以同项目多次启动（虽然 IPC start 阶段会校验 project status）。算合理设计（导出是幂等操作）。
3. **PackagerService 取消走 SIGTERM 不广播 progress**：cancel 后可能 electron-builder 已经 emit 完 progress 事件，关闭时这些进度仍可能被前端接收。前端需要能识别 cancelled 状态（PackageCompleteEvent.status='cancelled'）。✅ 已有。
4. **handleExportComplete cancelled 不影响 done**：cancelled 时 done 保留上次值。这是有意为之（用户切走又切回时，cancelled 之前的 done 状态仍然有效）。
5. **chat.ts 的 cancelActiveTasks 是 fire-and-forget**：不等 3 个 cancel 都返回就完成。切项目立刻响应，后台慢慢取消。
6. **prevProjectIdRef 用 useRef 替代 useState**：避免不必要 re-render。✅ 正确。
7. **App.tsx effect 依赖只有 currentProjectId**：zustand selector 只在 currentProjectId 变化时重跑。✅ 正确。

## 4. 总结

本轮 5 项遗留修复**全部完成、typecheck/lint/全量测试均通过**。但审计额外识别出 **8 项新发现**：

- **🔴 P0（必修 1 项）**：P0-5-1 Developer 取消后误推 error 给用户。
- **🟠 P1（应修 4 项）**：P0-5-2 打包取消缺 SIGKILL 兜底；P1-14-1 fullscreenOpenerRef 多实例冲突；P1-14-2 全屏弹层 focus 未管理；P1-15-1 SaveLocationDialog StrictMode 双跑覆盖 trigger。
- **🟡 P2（建议补 3 项）**：3 处关键改动（ConfirmDialog / DocumentMarkdown / 3 个 service 的 cancel）缺单元测试。

建议下一步：先修 P0-5-1（影响所有切项目场景的用户体验），再批量修 P1（4 项），最后补 P2 测试。

---

## 5. 本轮修复结果（v3.2.2 第 6 轮·第二轮）

> 用户答复"全修（推荐）"，按上述建议顺序批量修复。

### 5.1 修复项清单（5 项代码修复 + 5 项单测补齐）

| # | 发现项 | 修复文件 | 关键改动 |
|---|---|---|---|
| 1 | 🔴 P0-5-1 | [developer.ts](file:///e:/FreeCoder/src/main/dev/developer.ts) + [project.ts](file:///e:/FreeCoder/src/main/ipc/project.ts) | catch 分支识别 `DSHError('TASK_CANCELLED')` → `finish({cancelled: true})`；两处 IPC `onDone` 加 `if (outcome.cancelled) return;` 守门，不广播红色 error |
| 2 | 🟠 P0-5-2 | [service.ts (package)](file:///e:/FreeCoder/src/main/package/service.ts) | cancel 加 5 秒 SIGKILL 兜底（见 5.3 附带的额外 bug 修复） |
| 3 | 🟠 P1-14-1 | [DocumentMarkdown.tsx](file:///e:/FreeCoder/src/renderer/components/Documents/DocumentMarkdown.tsx) | unmount `useEffect` 把 `fullscreenOpenerRef.current` 还原为 noop |
| 4 | 🟠 P1-14-2 | [DocumentMarkdown.tsx](file:///e:/FreeCoder/src/renderer/components/Documents/DocumentMarkdown.tsx) | 全屏弹层 mount 后 `autoFocus` + `tabIndex={-1}` 让 ESC 立即生效 |
| 5 | 🟠 P1-15-1 | [SaveLocationDialog.tsx](file:///e:/FreeCoder/src/renderer/components/SaveLocationDialog.tsx) | `wasMountedRef` 守门，首次挂载才记录 trigger + showModal |
| 6 | 🟡 P1-15-2 单测 | [confirm-dialog.test.tsx](file:///e:/FreeCoder/tests/unit/confirm-dialog.test.tsx) | **新建**，5 个测试覆盖焦点恢复（关闭按钮/ESC/遮罩/弹窗内按钮 focus 变化/再次打开） |
| 7 | 🟡 P1-13+14 单测 | [document-markdown.test.tsx](file:///e:/FreeCoder/tests/unit/document-markdown.test.tsx) | **新建**，11 个测试覆盖链接降级（https/mailto/file/javascript/相对路径）+ 图片放大（渲染/点击/ESC/遮罩/关闭按钮/内层 stopPropagation） |
| 8 | 🟡 P0-5-3 Developer cancel 单测 | [developer.test.ts](file:///e:/FreeCoder/tests/unit/developer.test.ts) | 加 4 个 cancel 测试（幂等 / TASK_CANCELLED 识别 / signal abort 捕获 / 二次启动不误杀） |
| 9 | 🟡 P0-5-3 ExportService cancel 单测 | [export-service.test.ts](file:///e:/FreeCoder/tests/unit/export-service.test.ts) | 加 3 个 cancel 测试 + `FakeInertStorage`（可控 delay） |
| 10 | 🟡 P0-5-3 PackagerService cancel 单测 | [packager-service.test.ts](file:///e:/FreeCoder/tests/unit/packager-service.test.ts) | **新建**，4 个测试（未注册幂等 / 调 SIGTERM / Map 清理二次 cancel / 5 秒 SIGKILL 兜底） |

### 5.2 全量验证（修复后）

| 项目 | 结果 | 对比基线 |
|---|---|---|
| `pnpm typecheck` | ✅ **PASS** | main + renderer 双配置均通过 |
| `pnpm lint` | ✅ **0 errors**（9 warnings 全部预先存在，与本轮无关） | — |
| `pnpm test` | ✅ **418 passed / 49 suites** | 比基线 391 **+27 测试**（confirm-dialog 5 + document-markdown 11 + developer 4 cancel + export-service 3 cancel + packager-service 4 cancel） |

### 5.3 审计额外发现并修复的实现 bug

> 🐛 **PackagerService.cancel 的 `!child.killed` 检查是 dead code**

**位置**：[service.ts:89](file:///e:/FreeCoder/src/main/package/service.ts#L89)（修复前）

```ts
const timer = setTimeout(() => {
  if (this.currentByProject.get(projectId) === child && !child.killed) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
}, 5000);
```

**问题**：Node.js `ChildProcess.killed` 在 `kill()` 调用后就被置为 `true`（这是 Node 内置行为）。cancel() 内第一步就是 `child.kill('SIGTERM')`，所以 5 秒后 `child.killed` 永远是 `true`，`!child.killed` 永远是 `false`，escalate 永远不会触发——SIGKILL 兜底完全失效。

**修复**：去掉 `!child.killed` 检查，仅用 `Map.get(projectId) === child` 判断（child.on('exit') handler 在 exit 时 delete Map，所以 Map 里还能查到 child 说明进程还活着）：

```ts
const timer = setTimeout(() => {
  if (this.currentByProject.get(projectId) === child) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
}, 5000);
```

**测试验证**：`packager-service.test.ts` 第 4 个测试用例 `SIGKILL 兜底：5 秒内 child 未退出 → escalate 为 SIGKILL`，mock spawn 不派发 'exit'，验证 5 秒后 `killedSignals === ['SIGTERM', 'SIGKILL']`。

### 5.4 总结

- **8 项新发现项全部修复**，含 5 项代码修复 + 5 项单测补齐（developer/export-service/packager-service 三处 cancel 都有单测覆盖）。
- **审计额外发现 1 项实现 bug**（PackagerService.cancel dead code），同步修复并加单测守护。
- **全量验证通过**：typecheck clean / lint 0 errors / test 418 passed（+27）。
- 项目已具备 v3.2.2 发布条件：剩余项 P2-19 已在前序修复，文档已就绪。