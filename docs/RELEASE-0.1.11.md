# FreeCoder 0.1.11 Release Notes

**发布日期**：2026-09-04
**协议**：MIT License
**Git tag**：`v0.1.11`
**基线版本**：[v0.1.10](https://github.com/Ximencuishui/FreeCode/releases/tag/v0.1.10)（commit `cc81339`）

## 版本概述

0.1.11 是聚焦 **新建项目 AI 助理自动激活需求引导** 的小版本，修复 0.1.10 漏修的关键 Bug：

新建项目后，AI 助理不会主动开口问需求（底部 DSH 状态栏显示「休眠中」），用户必须先敲一句话才能触发引导对话；本次修复让 AI 在新建项目完成的瞬间就主动打招呼、预告 5 步流程并抛出第一个问题，DSH 引擎继续保持休眠（需求调研阶段不需要启动开发引擎）。

**核心目标**：

- 🟠 **关键 Bug 修复**：新建项目后 AI 助理不主动激活需求引导对话
- ✨ **架构新增**：`src/main/llm/` —— 独立于 DSH 的轻量 LLM 客户端 + Skill 抽象层
- ✨ **架构新增**：`icebreaking` skill —— 5 步流程预告 + 第一个问题

**测试覆盖**：

- 单元测试：471 passed（51 个测试文件，含本版本新增 35 个用例）
- E2E：核心旅程沿用 0.1.02 基线，本版本无新增

---

## 🟠 关键 Bug 修复（1 项）

### Bug：新建项目后 AI 助理不主动激活需求引导

**问题**：新建项目 → 进入欢迎页 / 引导页 → AI 助理浮窗空空如也，DSH 状态栏徽章显示「💤 休眠中」。用户必须先在聊天框敲一句话（如「做个小程序」），AI 才会进入引导模式。这与《产品需求文档 v3.0 §2.1.2》定义的 5 步需求引导流程不符 —— 引导应该是 AI **主动**发起，而不是被动响应。

**期望的体验**：

```
[新建项目] 创建了一个名为「我的记账 App」的项目。
[AI 助理浮窗]
  💭 AI 正在准备首次沟通…
  💭 AI 正在准备首次沟通，已用时 5 秒…

  你好！「我的记账 App」这个名字听起来很有意思！
  接下来我会按 5 步跟你一起把这个想法聊清楚：
    1. 破冰：你已经说出想做什么
    2. 目标用户：谁会用这个应用
    3. 核心功能：主要用来做什么
    4. 使用场景：什么时候用、怎么用
    5. 视觉偏好：希望长成什么样

  那您今天想创造什么呢？
  请选择：
  A. 健身相关
  B. 学习相关
  C. 生活管理
  D. 社交社区
```

**根因**：0.1.10 之前的版本只把「DSH」作为唯一 AI 入口，需求引导也走 DSH 子进程。但 DSH 是开发引擎，启动会闪「任务进行中」徽章，DSH 启动耗时也长（秒级），不适合做"秒回"的破冰问候；产品需求文档也明确区分了"需求调研阶段"与"开发执行阶段"。

**修复方案**：

新增 `src/main/llm/` 子系统作为"需求调研阶段"的轻量 AI 通道，与 DSH 完全解耦：

- **`src/main/llm/client.ts`（新增，231 行）** —— `LLMClient` HTTP 客户端
  - 直接调 DeepSeek / OpenAI 兼容 API（Bearer Token 鉴权）
  - 非流式（`stream: false`），破冰场景 5~15 秒回复够用，避免流式复杂度
  - 4 种错误码归一：`API_KEY_MISSING / AUTH_INVALID / TIMEOUT / LLM_ERROR`
  - 支持 `AbortSignal` + 30s 默认超时，`reasoning_content` 字段透传（DeepSeek 推理模型）
  - 与 DSH 的 `apiKeyProvider` 写法保持一致，复用 `storage.loadApiKey() + storage.getSettings()`

- **`src/main/llm/skill.ts`（新增，195 行）** —— Skill 抽象层 + `runSkill` 统一入口
  - 拼 messages → 调 LLM → 持久化 assistant 消息 → 广播 `thinking / message / done` 事件
  - 8 秒 `thinking` 心跳，避免用户空等（与 `chat:send` IPC 的 `progressTimer` 风格一致）
  - 错误按 `LLMError.code` 分流：`API_KEY_MISSING` 静默、`AUTH_INVALID/TIMEOUT/LLM_ERROR` 推 `chat:signal: error`
  - 永远 `resolve`（不 reject）—— fire-and-forget 调用方无需关心

- **`src/main/llm/skills/icebreaking.ts`（新增，65 行）** —— 破冰 skill
  - `createIcebreakingSkill(projectName)` 工厂 —— 每个项目独立 systemPrompt（避免不同项目间串扰）
  - 5 步流程预告 + 「请选择：」 + A/B/C/D 选项
  - 风格约束：中文口语化、一次只问 1 个问题、避免技术术语、不输出 JSON

- **`src/main/ipc/project.ts`（修改）** —— `registerProjectIpc` 增加 `llmClient` 参数
  - 新增 `triggerIcebreaking(meta)` 闭包，在 `projectCreate` handler 末尾 fire-and-forget 调用
  - 不阻塞 IPC 返回；runSkill 内部已处理所有错误，这里仅防御性兜底

- **`src/main/ipc/index.ts`（修改）** —— `registerIpcHandlers` 透传 `llmClient`

- **`src/main/index.ts`（修改）** —— 创建 `LLMClient` 实例并注入 IPC

**修改文件**：

- `src/main/llm/client.ts`（新增）
- `src/main/llm/skill.ts`（新增）
- `src/main/llm/skills/icebreaking.ts`（新增）
- `src/main/ipc/project.ts`
- `src/main/ipc/index.ts`
- `src/main/index.ts`

---

## ✨ 架构新增（2 项）

### 1. `LLMClient` 轻量 HTTP 客户端

`src/main/llm/client.ts` —— 直接调 DeepSeek / OpenAI 兼容 API，不依赖 DSH 子进程。

**设计取舍**：

- **不复用 DSH 子进程**：DSH 是开发引擎（启动 +1s 闪屏 + 持久 session），需求阶段只需要"秒回"的轻量调用
- **凭据复用**：`apiKeyProvider: async () => ({ apiKey, provider, baseUrl, model })` 与 `DSHService` 同源写法
- **错误归一**：`LLMError(code, message)` 让上层（`runSkill`）按 code 分流
- **预留流式**：`onDelta?: (delta: string) => void` 留 TODO，第一版只做非流式
- **不引入新依赖**：纯 `fetch` + `AbortController`（Node 18+ 内置）

### 2. `Skill` 抽象层

`src/main/llm/skill.ts` —— 把"轻量 LLM 任务"封装成统一入口。

**接口设计**：

```typescript
interface Skill {
  id: SkillId; // 'icebreaking'
  systemPrompt: string;
  buildMessages: (input: SkillInput) => Array<Omit<LLMMessage, 'role'> & { role: 'user' | 'assistant' }>;
}
```

**`runSkill` 职责**：

1. 同步广播初始 `thinking` 事件（前端立刻显示「AI 正在准备首次沟通…」）
2. 启动 8 秒 `thinking` 心跳（与 `chat:send` 的 `progressTimer` 风格一致）
3. 拼 `messages = [system, ...buildMessages()]` 调 `llm.call`
4. 持久化 assistant 消息到 `chatHistory`
5. 广播 `message` 事件（含 `reasoning`）+ `done` 事件
6. 错误时按 `LLMError.code` 分流

**未来扩展点**：未来 5 步流程的其余 4 步（目标用户 / 核心功能 / 使用场景 / 视觉偏好）可直接实现 `Skill` 接口，注册到 `runSkill` 即可。

---

## ✅ 兼容性 / 升级说明

- **DSH 行为不变**：本次新增的 `LLMClient` 与 DSH 完全解耦，DSH 子进程仍按原方式在「开发执行阶段」按需启动
- **`registerProjectIpc` 签名变更**：增加第 5 个参数 `llmClient: LLMClient`。所有现有调用方（`src/main/ipc/index.ts`）已同步更新
- **`registerIpcHandlers` 签名变更**：增加第 5 个参数 `llmClient: LLMClient`。主入口 `src/main/index.ts` 已同步更新
- **DSH 状态栏徽章语义不变**：新建项目后徽章仍是「💤 休眠中」（DSH 按需启动；破冰走 LLM 不启动 DSH）
- **`chat:response` / `chat:signal` 事件协议不变**：破冰复用既有通道，前端 `useChatEvents` 无需任何改动
- **直接安装包覆盖即可**，**无需手动操作**

---

## 🧪 测试覆盖明细

### 新增守护用例（35 个）

| 测试文件 | 用例 | 覆盖范围 |
|---------|------|--------|
| `tests/unit/llm-client.test.ts`（新增） | `resolveEndpoint` 等 19 个用例 | DeepSeek/openai 端点、baseUrl 后缀处理、401/403/500、超时、AbortSignal、网络错误、JSON 解析失败、`reasoning_content`、choices 为空、override model |
| `tests/unit/llm-skill-icebreaking.test.ts`（新增） | `buildMessages` / `runSkill` 等 13 个用例 | buildMessages 结构、runSkill 成功路径、错误分流 5 种码、thinking 心跳、永远 resolve |
| `tests/unit/project-ipc.test.ts`（修改） | `projectCreate` 自动触发破冰 3 个用例 | fire-and-forget 调 `llm.call`、LLM 抛错 IPC 仍正常返回、`API_KEY_MISSING` 静默 |

### 回归覆盖

- `parseDshOutput` / `runTask` 既有 5 个测试用例保持通过，无回归
- `DSHService` 状态机 7 个测试用例保持通过，无回归
- `FakeStorage` 补 `getDefaultProjectsDir` 方法（`registerProjectIpc` 新参数需要的接口）

---

## 完整测试结果

| 维度 | 数值 |
|------|------|
| 单元测试 | **471 passed** / 51 测试文件 / 100% 通过率 |
| 新增单元测试 | +35 用例（覆盖 LLMClient / Skill / projectCreate 集成） |
| typecheck | ✅ 通过（`pnpm typecheck`） |
| lint | ✅ 0 errors（`pnpm lint`） |
| 回归 / 集成测试 | 全部 PASS |
| 构建产物 | ✅ `pnpm build && electron-builder --win` 成功（`FreeCoder 0.1.11.exe` + `FreeCoder Setup 0.1.11.exe`） |

---

## 已知限制（沿用 0.1.x）

- 生成的应用为静态 Web 应用（HTML/CSS/JS + localStorage 数据），无后端数据库
- 多轮对话基于 headless 单次任务模式（历史拼入上下文），长对话 token 成本较高
- 界面语言仅中文
- `LLMClient` 第一版只做非流式；流式响应（`onDelta`）留 TODO，第二版接入
- 破冰只覆盖"第 1 步：破冰 + 5 步流程预告"；后续 4 步（目标用户 / 核心功能 / 使用场景 / 视觉偏好）的 skill 待后续版本迭代
- 每个项目"独立上下文记忆"功能（用户在 Bug 描述中提及的另一项需求）本次未实现，留待后续版本

---

## 致谢

感谢 DeepSeek 开源的 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/DeepSeek-Harness) 作为底层 Agent 引擎。

---

📦 **安装**：直接下载本 release 中的 `FreeCoder-0.1.11-*.{exe}` 安装包覆盖安装即可。
📋 **Git tag**：`v0.1.11`（commit 见 release 详情）