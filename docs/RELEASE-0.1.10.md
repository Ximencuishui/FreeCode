# FreeCoder 0.1.10 Release Notes

**发布日期**：2026-09-04
**协议**：MIT License
**Git tag**：`v0.1.10`
**基线版本**：[v0.1.02](https://github.com/Ximencuishui/FreeCode/releases/tag/v0.1.02)（commit `ebf8c62`）

> 注：0.1.03 ~ 0.1.09 是 0.1.02 之后的 DSH 状态机改造 / 内置运行时漏装根因修复 /
> CI 流水线完善等迭代。详细变更见 `CHANGELOG.md` 中对应版本段；0.1.09 是
> 「DSH 状态机 + 漏装根因修复」综合版本，0.1.10 是第一个面向用户的体验
> 修复版本。

## 版本概述

0.1.10 是聚焦 **AI 助理引导式需求分析体验** 的小版本，修复 0.1.09 漏修的关键 Bug：
新建项目输入「做个小程序」后，AI 原本只回单行「E. 其他（告诉我具体是啥）」，看起来像
没进入引导对话；本次修复让用户能看到完整「请选择：」+ A/B/C/D/E 五个选项的引导式
对话结构。同步修复 stderr 调试回显污染 reply 的隐藏 bug。

附带新增 **DraggableChat 顶部 resize handle**（v0.1.07 用户请求）。

**核心目标**：
- 🟠 **关键 Bug 修复**：引导式需求分析多行回复截断、stderr 调试回显污染 reply
- ✨ **UI 增强**：DraggableChat 顶部边缘可上下拉伸

**测试覆盖**：
- 单元测试：436 passed（49 个测试文件，含本版本新增 1 个端到端守护用例）
- E2E：核心旅程沿用 0.1.02 基线，本版本无新增

---

## 🟠 关键 Bug 修复（2 项）

### Bug-1：引导式需求分析多行回复被截断为单行

**问题**：新建项目 → 输入「做个小程序」→ 回复只显示最后一行「E. 其他（告诉我具体是啥）」，
看起来像 AI 没进入引导式需求分析对话模式。

**期望的完整回复**：

```
好的！做小程序的想法挺不错。在开始之前，我想先跟你聊清楚几个关键问题…
第一个问题：**这个小程序主要用来做什么？**
请选择：
A. 健身相关（记录运动、约课、买课等）
B. 学习相关（背单词、做笔记、刷题等）
C. 生活管理（记账、打卡、待办事项等）
D. 社交社区（聊天、兴趣圈子、找搭子等）
E. 其他（告诉我具体是啥）
```

**根因**：`parseDshOutput` 在没有 `<<<FC_*>>>` 信封标记的 fallback 路径里直接调用
`extractLastReply(stdout)`，仅取最后一条非空行。DSH 实际 stdout 是 227 字符的完整
多行引导语，被截断成 9 字符「其他（告诉我具体是啥）」。用户从渲染层完全看不到
问题上下文与 4 个有效选项，UX 等严重失败。

**为什么 0.1.09 没发现**：0.1.09 的 dsh 状态机改造主要在多 manager 并发场景，
未对单 manager 的 stdout 解析做回归断言；旧测试 `parseDshOutput：无信封时回退为
最后一行` 反向固化了 bug 行为（pinned the bug）。

**修复方案**：
- 新增 `stripMarkerLines(stdout)` 工具函数：剔除空行 + `<<<FC_*>>>` marker 噪音行，
  保留完整多行回复
- `parseDshOutput` fallback 改用 `stripMarkerLines(stdout)`；`extractLastReply`
  保留为独立工具函数供其他场景复用
- `tests/unit/dsh-service.test.ts`：取消「只取最后一行」错误预期，新增 1 个守护用例
  用真实 bug 场景（227 字符完整回复 + 5 个选项）做断言
- 所有 49 个测试套件、436 个单元测试通过

**修改文件**：
- `src/main/dsh/service.ts`

---

### Bug-2：stderr 调试回显混入 reply 字符串

**问题**：作为 Bug-1 修复的连锁发现。`runTask` 把 child_process 的 stderr 调试回显
（如 `[FakeDSH] profile=... task=...`）也累加进 `output`，最终被 `parseDshOutput`
当作 reply 一部分写入聊天历史。导致聊天历史偶现调试噪音、触发 parseDshOutput 的
噪音行误判。

**根因**：`runTask` 的 `output += o.data` 未区分 `stream`（stdout / stderr）。

**修复方案**：
- 改为 `if (o.stream === 'stdout') output += o.data`，stderr 仅实时转发给
  `onProgress` 用于渲染进度反馈（如 dsh 安装提示），不再混入 reply
- `tests/unit/fixtures/fake-dsh.js`：`[FakeDSH] profile/task` 回显从 `console.log`
  迁到 `console.error`（stdout → stderr），与主代码改动同步，避免夹具回显污染 stdout
- 新增 1 个端到端守护用例：`runTask` 跑完需求分析多行回复场景，验证 `result.reply`
  完整保留、不被 stderr 污染

**修改文件**：
- `src/main/dsh/service.ts`
- `tests/unit/fixtures/fake-dsh.js`
- `tests/unit/dsh-service.test.ts`

---

## ✨ UI 增强（1 项）

### DraggableChat 顶部 resize handle

v0.1.07 用户请求：AI 助理浮窗沿顶部边缘可上下拉伸窗口（之前只能四角拉伸）。

- `DraggableChat` 顶部 6px 边缘新增 resize handle，沿 Y 轴上下拖动改高度
- `startDrag` 已支持 `'n'` 方向，与现有 nw/ne 角 handle 共享 8px 边界避免行为跳变
- 沿用既有 `getBoundingClientRect()` + `requestAnimationFrame` 节流机制，无回归
- `tests/unit/draggable-chat.test.tsx`：新增顶部 handle 鼠标事件用例

**修改文件**：
- `src/renderer/components/Chat/DraggableChat.tsx`
- `tests/unit/draggable-chat.test.tsx`

---

## ✅ 兼容性 / 升级说明

- **`parseDshOutput`** 返回类型不变（`{ reply: string; reasoning?: string }`），
  仅 fallback 路径返回值从「最后一行」变为「完整多行」
- **`runTask`** 内部行为变化：stderr 不再进入 reply 字段；onProgress 仍能收到 stderr
- **DSH 协议不变**：FC_* envelope marker 仍按既有约定解析，新增的 `stripMarkerLines`
  仅作用于 fallback 路径
- **DraggableChat 位置 / 尺寸持久化** 不受影响（localStorage 读写 key 不变）
- 直接安装包覆盖即可，**无需手动操作**

---

## 🧪 测试覆盖明细

### 新增守护用例（3 个，含 1 个端到端）

| 测试文件 | 用例 | 覆盖范围 |
|---------|------|---------|
| `tests/unit/dsh-service.test.ts` | `parseDshOutput：无信封时保留完整多行（不再只取最后一行），推理为空` | Bug-1：用真实 227 字符 / 5 选项场景断言 `reply === 完整字符串` |
| `tests/unit/dsh-service.test.ts` | `parseDshOutput：无信封时剔除空行与 FC_* marker 噪音行` | Bug-1：stdout 含空行 + 噪声 marker 时输出干净 |
| `tests/unit/dsh-service.test.ts` | `runTask：需求分析多行回复完整保留（不再截断为最后一行）` | Bug-1 + Bug-2 端到端：跑 fake-dsh 模拟完整需求分析回复，断言 reply 完整 + 不混入 stderr |

### 回归覆盖

- `parseDshOutput` 既有 5 个测试用例（带/缺 reasoning、空 stdout、纯净 stdout、envelope 截断等）保持通过
- `runTask` 既有测试全部通过，无回归

---

## 完整测试结果

| 维度 | 数值 |
|------|------|
| 单元测试 | **436 passed** / 49 测试文件 / 100% 通过率 |
| 新增单元测试 | +1 端到端守护用例（覆盖 Bug-1 + Bug-2 端到端链路） |
| typecheck | ✅ 通过（`pnpm typecheck`） |
| 回归 / 集成测试 | 全部 PASS |
| 构建产物 | ✅ `pnpm package` 成功（`FreeCoder 0.1.10.exe` + `FreeCoder Setup 0.1.10.exe`） |

---

## 已知限制（沿用 0.1.x）

- 生成的应用为静态 Web 应用（HTML/CSS/JS + localStorage 数据），无后端数据库
- 多轮对话基于 headless 单次任务模式（历史拼入上下文），长对话 token 成本较高
- 界面语言仅中文
- `parseDshOutput` 的 fallback 路径只在 DSH 未输出 `<<<FC_*>>>` envelope 时生效；
  绝大多数情况下 DSH 都会输出 envelope，此 fallback 仅作为兜底

## 致谢

感谢 DeepSeek 开源的 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/DeepSeek-Harness) 作为底层 Agent 引擎。

---

📦 **安装**：直接下载本 release 中的 `FreeCoder-0.1.10-*.{exe}` 安装包覆盖安装即可。
📋 **Git tag**：`v0.1.10`（commit `cc81339`）