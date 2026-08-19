# DSH 集成调研结论（WP-08 Spike）

**更新日期**：2026-08-19
**DSH 版本**：`@deepseek-ai/dsh` 0.1.0-rc.6（G:\DSH 本地 checkout）
**状态**：核心路径已验证（真实 headless 联调通过）

## 一、DSH 是什么

DSH（DeepSeek Harness）是 DeepSeek 开源的 Agent 运行时：基于 cordis 的插件化配置树，提供 Agent Teams、代码生成、工具调用、Hermes 结构化输出等能力。`@deepseek-ai/dsh` 是其 CLI 启动器（`dsh` bin → `lib/bin.js`），支持启动不同 profile（web / headless / 自定义）。

## 二、已验证事实

### 2.1 CLI 入口与模式

| 命令 | 行为 | FreeCoder 用途 |
|------|------|----------------|
| `dsh --profile headless "任务"` | 一次性任务：创建持久化 Agent → 提交任务 → 等待完成 → **最终回复写 stdout** → 退出（0=完成，1=未完成） | ✅ 已采用（每轮对话启动一次） |
| `dsh --profile web` | 浏览器 UI + 本地 HTTP 服务（web-server / api-proxy） | 备选（长驻多轮会话） |
| `dsh --dump-config` | 打印组合后的配置树 | 调试 |

**真实联调验证**（2026-08-19）：
```
$ npx --no-install dsh --profile headless "只回复两个字：你好"
你好
$ echo $?   # 0
```

### 2.2 配置机制（重要）

- 数据目录：`$DSH_HOME`（默认 `~/.dsh`）
  - `settings.yaml`：LLM provider 定义 + `agent-default-model`（provider / model / reasoningEffort）
  - `.credentials.yaml`：API Key（如 `DEEPSEEK_API_KEY: sk-...`）
  - `profiles/<name>/`：profile 目录（`cordis.yml` bundle 层 + `cordis.patch.yml` 用户覆盖）
- headless / web profile **首次使用自动初始化**（从随附模板）
- API Key 也可经环境变量注入（provider 的 `apiKeyEnv` 字段）

**对 FreeCoder 的意义**：FreeCoder 用户自备 DeepSeek API Key（safeStorage 加密存储）。集成时可为 FreeCoder 准备独立的 `DSH_HOME`（如 `~/.freecoder/dsh-home`），首启时：
1. 用模板初始化 headless profile
2. 写入 `settings.yaml`（provider=deepseek-official 或自定义 baseURL，model=deepseek-chat 等）
3. 写入 `.credentials.yaml`（DEEPSEEK_API_KEY = 用户 key，来自 safeStorage 解密）

### 2.3 headless 的限制

- **单次任务、无交互**：进程提交一个任务后等待完成即退出，没有对话续接接口
- **多轮对话策略（WP-10 决策）**：
  - 方案 A（当前倾向）：每轮把「需求卡片 + 全部对话历史 + 新消息」拼进任务文本，启动新 headless 进程 → 简单可靠，但上下文随轮次增长
  - 方案 B：`dsh --profile web` 长驻进程 + HTTP API（未验证，工作量更大，但支持真会话持久化）
- stdout 内容 = headless runner 打印的最后一条非空 assistant 文本（日志通常走 stderr）

## 三、FreeCoder 集成落地（已完成部分）

| 组件 | 位置 | 说明 |
|------|------|------|
| 进程管理器 | `src/main/dsh/manager.ts` | spawn / stdin/stdout 管道 / 状态机 / 崩溃自动重启（已测 IT-DSH-001~005） |
| 一次性任务服务 | `src/main/dsh/service.ts` | `runTask(projectDir, task)` → `{ reply, exitCode }`（已测） |
| 命令解析 | `resolveDshCommand()` | `FREECODER_DSH_COMMAND` 环境变量覆盖，默认 PATH 中的 `dsh` |

## 四、打包注意事项（WP-25 落地）

- 应用分发需内置 Node 运行时 + `@deepseek-ai/dsh` 包（`resources/dsh/`），启动命令形如：
  `[node.exe, <resources>/dsh/bin.js, --profile, headless, task]`
- 通过 `FREECODER_DSH_COMMAND` 指向内置运行时
- DSH 依赖体积较大（cordis 全家桶），打包时需裁剪（仅 headless 所需 bundle）

## 五、风险与后续

- **多轮会话上下文**：方案 A 的 prompt 拼接需在 WP-10 实测（长历史 → token 成本）；若不可行切换方案 B（web HTTP）
- **DSH_HOME 隔离**：FreeCoder 应用独立 `DSH_HOME`，不与用户日常 DSH 环境冲突
- **模型选择**：`settings.yaml` 中 `agent-default-model` 可由 FreeCoder 设置面板配置（默认 deepseek-chat）

---

**结论**：headless 一次性任务模式已验证可用，作为 FreeCoder 0.1.x 的 DSH 集成主路径；进程管理与任务服务层已实现并通过测试。
