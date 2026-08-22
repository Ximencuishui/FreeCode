好的，我现在开始撰写 **技术架构设计文档**。

---

# FreeCoder 技术架构设计文档

**版本**：1.0
**状态**：定稿
**更新日期**：2026-08-19
**适用版本**：FreeCoder 0.1.x


## 一、文档说明

### 1.1 文档目的
本文档描述 FreeCoder 桌面应用的技术架构设计，包括整体架构、模块划分、技术选型、数据流、安全设计、构建与发布策略。旨在为开发团队提供统一的技术蓝图，指导编码实现。

### 1.2 适用范围
- FreeCoder 0.1.x 开源桌面端
- 平台支持：Windows / macOS / Linux
- 技术栈：Electron + React + TypeScript + DSH

### 1.3 相关文档
- FreeCoder 产品需求文档 v3.0
- FreeCoder 前端设计说明书 v1.0


## 二、整体架构

### 2.1 架构分层

FreeCoder 采用 **四层架构**，从上到下依次为：

| 层级 | 名称 | 职责 | 运行环境 |
|------|------|------|---------|
| **第 1 层** | 用户交互层 | 渲染 UI，捕获用户输入，展示反馈 | 渲染进程（Renderer） |
| **第 2 层** | 应用控制层 | 业务逻辑编排，状态管理，进程通信 | 主进程（Main） |
| **第 3 层** | AI 引擎层 | DSH 进程管理，信号拦截与翻译 | 主进程 + 子进程 |
| **第 4 层** | 基础设施层 | 本地存储，文件系统，安全加密 | 主进程 |


### 2.2 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        第 1 层：用户交互层                      │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  React 组件                                              │ │
│  │  - 对话界面 (Chat)   - 预览窗口 (Preview)                 │ │
│  │  - 需求卡片 (RequirementCard)   - 设置面板 (Settings)     │ │
│  │  - 导出面板 (ExportPanel)   - 导航栏 (Navigation)         │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  状态管理 (Zustand)                                      │ │
│  │  - 对话状态   - 需求状态   - 预览状态   - 应用状态        │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  IPC 通信层 (preload.ts)                                 │ │
│  │  - 暴露安全的 API 给渲染进程                              │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │ IPC
┌─────────────────────────────▼───────────────────────────────────┐
│                        第 2 层：应用控制层                      │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  主进程控制器 (Main)                                     │ │
│  │  - 窗口管理   - 应用生命周期   - 菜单管理                 │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  业务编排层 (Orchestrator)                               │ │
│  │  - AI 助理对话流编排   - 需求状态管理                     │ │
│  │  - 预览生命周期管理   - 导出流程编排                      │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  信号拦截与翻译 (Signal Interceptor)                     │ │
│  │  - 监听 DSH 输出流   - 信号匹配与翻译   - 状态同步        │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │ 进程管理
┌─────────────────────────────▼───────────────────────────────────┐
│                        第 3 层：AI 引擎层                       │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  DSH 进程管理器 (DSH Process Manager)                    │ │
│  │  - 启动/停止 DSH 子进程   - 注入预设配置                  │ │
│  │  - stdin/stdout 通信   - 进程状态监控                    │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  DSH 内核 (DeepSeek Harness)                             │ │
│  │  - Agent Teams（开发团队）   - 代码生成                   │ │
│  │  - 文件系统操作   - 工具调用                             │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  本地模型服务 (DeepSeek API 客户端)                      │ │
│  │  - API Key 管理   - 请求签名   - 响应处理                │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │ 文件 I/O
┌─────────────────────────────▼───────────────────────────────────┐
│                        第 4 层：基础设施层                      │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  本地存储 (Storage)                                      │ │
│  │  - 项目文件管理   - 对话历史持久化   - 设置存储           │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  安全模块 (Security)                                     │ │
│  │  - API Key 加密（safeStorage）   - 沙箱隔离               │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  预览服务器 (Preview Server)                             │ │
│  │  - 本地 HTTP 服务   - 热加载   - 静态文件托管             │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```


## 三、技术选型

### 3.1 核心技术栈

| 组件 | 技术选型 | 版本 | 选型理由 |
|------|---------|------|---------|
| 桌面框架 | Electron | 28+ | 跨平台、成熟生态、自包含 Chromium |
| 前端框架 | React | 18 | 生态丰富、组件化、与 TypeScript 完美配合 |
| 开发语言 | TypeScript | 5.0+ | 类型安全、减少运行时错误 |
| 状态管理 | Zustand | 4.4+ | 轻量、简单、无模板代码 |
| UI 样式 | Tailwind CSS | 3.3+ | 原子化 CSS、无需切换上下文 |
| 图标库 | Lucide React | 最新 | 线条风格、可定制、与 Feather 同源 |
| 动画库 | Framer Motion | 10+ | React 原生、声明式动画 |
| 构建工具 | Vite | 5.0+ | 极速 HMR、现代构建方式 |
| 包管理器 | pnpm | 8.0+ | 节省磁盘空间、依赖隔离 |

### 3.2 AI 引擎

| 组件 | 技术选型 | 说明 |
|------|---------|------|
| Agent 框架 | DeepSeek Harness (DSH) | MIT 开源，内置 Agent Teams |
| AI 模型 | DeepSeek API / 兼容 OpenAI API | 用户自行配置 |
| 本地运行 | DSH 作为子进程运行 | 完全本地执行 |

### 3.3 开发工具链

| 工具 | 用途 |
|------|------|
| ESLint | 代码规范检查 |
| Prettier | 代码格式化 |
| Husky + lint-staged | Git pre-commit 钩子 |
| electron-builder | 跨平台打包 |
| electron-updater | 自动更新（后续版本） |
| Jest | 单元测试 |
| Playwright | 端到端测试 |


## 四、模块详细设计

### 4.1 目录结构

```
freecoder/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
├── electron-builder.yml
│
├── src/
│   ├── main/                       # 主进程代码
│   │   ├── index.ts                # 入口
│   │   ├── window.ts               # 窗口管理
│   │   ├── menu.ts                 # 应用菜单
│   │   ├── ipc/                    # IPC 处理器
│   │   │   ├── chat.ts             # 对话相关
│   │   │   ├── project.ts          # 项目相关
│   │   │   ├── preview.ts          # 预览相关
│   │   │   └── export.ts           # 导出相关
│   │   ├── dsh/                    # DSH 管理
│   │   │   ├── manager.ts          # DSH 进程管理
│   │   │   ├── signals.ts          # 信号映射表
│   │   │   └── translator.ts       # 信号翻译器
│   │   ├── storage/                # 本地存储
│   │   │   ├── project.ts          # 项目管理
│   │   │   ├── session.ts          # 会话管理
│   │   │   └── settings.ts         # 设置管理
│   │   └── security/               # 安全模块
│   │       └── encryption.ts       # API Key 加密
│   │
│   ├── renderer/                   # 渲染进程代码
│   │   ├── index.html
│   │   ├── main.tsx                # React 入口
│   │   ├── App.tsx                 # 根组件
│   │   ├── store/                  # Zustand 状态
│   │   │   ├── chat.ts             # 对话状态
│   │   │   ├── project.ts          # 项目状态
│   │   │   ├── preview.ts          # 预览状态
│   │   │   └── ui.ts               # UI 状态
│   │   ├── components/             # React 组件
│   │   │   ├── Chat/               # 对话组件
│   │   │   │   ├── ChatContainer.tsx
│   │   │   │   ├── Message.tsx
│   │   │   │   ├── MessageInput.tsx
│   │   │   │   └── RequirementCard.tsx
│   │   │   ├── Preview/            # 预览组件
│   │   │   │   ├── PreviewContainer.tsx
│   │   │   │   ├── PreviewToolbar.tsx
│   │   │   │   └── ElementInspector.tsx
│   │   │   ├── Navigation/         # 导航组件
│   │   │   ├── Settings/           # 设置面板
│   │   │   └── Export/             # 导出面板
│   │   ├── hooks/                  # 自定义 Hooks
│   │   │   ├── useIPCEvents.ts
│   │   │   ├── useDSHStatus.ts
│   │   │   └── usePreview.ts
│   │   ├── types/                  # TypeScript 类型
│   │   │   ├── chat.ts
│   │   │   ├── project.ts
│   │   │   └── dsh.ts
│   │   └── utils/                  # 工具函数
│   │       ├── formatter.ts
│   │       └── validator.ts
│   │
│   ├── preload/                    # Preload 脚本
│   │   └── index.ts                # 暴露安全的 API
│   │
│   └── shared/                     # 共享代码
│       ├── types/                  # 共享类型
│       └── constants/              # 常量定义
│
├── resources/                      # 打包资源
│   ├── icons/                      # 应用图标
│   └── dsh/                        # 内置 DSH 运行时
│       ├── node/                   # Node.js 运行时
│       └── harness/                # DSH CLI
│
├── tests/                          # 测试代码
│   ├── unit/
│   └── e2e/
│
└── docs/                           # 项目文档
    ├── README.md
    ├── CONTRIBUTING.md
    └── ...
```

### 4.2 核心模块说明

#### 4.2.1 DSH 进程管理器（`main/dsh/manager.ts`）

**职责**：
- 启动和停止 DSH 子进程
- 管理 DSH 运行环境（注入 Node.js 运行时路径）
- 通过 stdin/stdout 与 DSH 通信
- 监控 DSH 进程状态（运行中/停止/异常）
- 自动重启（崩溃恢复）

**核心接口**：

```typescript
interface DSHManager {
  // 启动 DSH 进程
  start(projectPath: string, requirements: Requirements): Promise<void>;
  
  // 向 DSH 发送指令
  sendCommand(command: string, params: any): Promise<void>;
  
  // 停止 DSH 进程
  stop(): Promise<void>;
  
  // 获取 DSH 状态
  getStatus(): DSHStatus;
  
  // 监听 DSH 输出
  onOutput(callback: (data: string) => void): void;
}
```

#### 4.2.2 信号拦截与翻译器（`main/dsh/translator.ts`）

**职责**：
- 监听 DSH 的 stdout/stderr 输出
- 匹配预定义的信号模式
- 将技术信号翻译为用户友好的自然语言
- 将翻译结果发送到渲染进程

**信号映射规则**：

```typescript
interface SignalRule {
  pattern: RegExp;
  category: 'info' | 'warning' | 'error' | 'question';
  translate: (match: RegExpMatchArray) => {
    message: string;
    suggestions?: string[];
    autoAction?: () => void;
  };
}

const signalRules: SignalRule[] = [
  {
    pattern: /database|需要数据库|连接数据库/i,
    category: 'question',
    translate: () => ({
      message: '您的项目需要保存数据，我来帮您配置本地数据库',
      suggestions: ['使用本地 SQLite', '稍后配置']
    })
  },
  {
    pattern: /error|失败|出错/i,
    category: 'error',
    translate: (match) => ({
      message: `遇到一点小状况：${match[0]}，正在自动处理…`,
      autoAction: () => { /* 触发自动修复 */ }
    })
  },
  // ... 更多规则
];
```

#### 4.2.3 本地存储模块（`main/storage/`）

**职责**：
- 项目文件的读写
- 对话历史的持久化
- 用户设置的存储
- 导出包的生成

**存储路径结构**：

```
~/.freecoder/
├── settings.json              # 用户设置
├── api-key.encrypted          # 加密后的 API Key
├── projects/
│   ├── {project-id}/
│   │   ├── meta.json          # 项目元数据
│   │   ├── requirements.json   # 需求卡片数据
│   │   ├── chat-history.json   # 对话历史
│   │   ├── code/              # 项目代码（DSH 生成）
│   │   │   ├── src/
│   │   │   ├── public/
│   │   │   └── package.json
│   │   └── exports/           # 导出的部署包
│   │       └── {timestamp}/
│   └── ...
└── logs/
    └── dsh.log                # DSH 运行日志
```

**核心接口**：

```typescript
interface StorageManager {
  // 项目管理
  createProject(name: string): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  deleteProject(id: string): Promise<void>;
  
  // 对话历史
  saveChatHistory(projectId: string, messages: Message[]): Promise<void>;
  loadChatHistory(projectId: string): Promise<Message[]>;
  
  // 设置
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  
  // API Key
  saveApiKey(key: string): Promise<void>;
  loadApiKey(): Promise<string | null>;
}
```

#### 4.2.4 安全模块（`main/security/encryption.ts`）

**职责**：
- API Key 的加密存储
- 敏感信息脱敏（日志、展示）

**加密方案**：

```typescript
// 使用 Electron 的 safeStorage API
import { safeStorage } from 'electron';

// 加密
function encryptApiKey(key: string): string {
  const buffer = Buffer.from(key, 'utf-8');
  const encrypted = safeStorage.encryptString(key);
  return encrypted.toString('base64');
}

// 解密
function decryptApiKey(encryptedBase64: string): string {
  const buffer = Buffer.from(encryptedBase64, 'base64');
  return safeStorage.decryptString(buffer);
}
```

#### 4.2.5 预览服务器（`main/preview/server.ts`）

**职责**：
- 启动本地 HTTP 服务（开发模式）
- 托管 DSH 生成的项目代码
- 支持热加载（文件变更自动刷新）
- 提供 WebSocket 用于实时通信

**核心实现**：

```typescript
class PreviewServer {
  private server: http.Server | null = null;
  private port: number = 3000;
  private projectPath: string = '';
  
  // 启动预览服务器
  async start(projectPath: string): Promise<string> {
    this.projectPath = projectPath;
    // 使用 Vite 或 Express 启动服务
    // 返回预览 URL: http://localhost:3000
  }
  
  // 停止服务器
  async stop(): Promise<void> {
    // 关闭服务器
  }
  
  // 刷新预览（热加载）
  async refresh(): Promise<void> {
    // 触发 WebSocket 刷新
  }
  
  // 获取预览状态
  getStatus(): PreviewStatus {
    // 返回运行状态
  }
}
```


#### 4.2.6 版本分段规划器与开发执行器（`main/dev/`）

**职责**：
- `VersionPlanner`（`main/dev/planner.ts`）：需求确认后、写代码前，由 AI 把已确认的核心功能切分为 V1（最小可用版本 MVP）与后续版本；AI 失败或返回无效 JSON 时使用**确定性兜底计划**（V1=第一个核心功能），保证流程不中断
- `Developer`（`main/dev/developer.ts`）：版本计划确认后，调用 DSH 在项目代码目录生成应用；**有版本计划时只开发 V1 功能子集**，避免非技术用户追求"大而全"而忽略 MVP

**状态流转**：`draft → planned（计划生成，待用户确认）→ developing（确认计划后）→ ready / exported`

**核心实现（版本分段规划器）**：

```typescript
class VersionPlanner {
  async generatePlan(projectId, onDone): Promise<void> {
    // 整体兜底：任何存储/解析异常都确保 onDone 必被回调一次，
    // 避免渲染端轮询无终止（防御性编程，见第七章）
    try {
      await storage.updateProjectMeta(projectId, { status: 'planned' });
      const requirements = await storage.getRequirements(projectId);
      if (!requirements || requirements.coreFeatures.length === 0) {
        onDone({ success: false, message: '需求尚未就绪，无法生成版本计划' });
        return;
      }
      let plan = null;
      try {
        const result = await dsh.runTask(path, buildVersionPlanTask(requirements));
        if (result.exitCode === 0) plan = tryParseVersionPlan(result.reply);
      } catch { /* 使用兜底计划 */ }
      if (!plan) plan = fallbackVersionPlan(requirements.coreFeatures);
      await storage.updateProjectMeta(projectId, { versionPlan: plan });
      onDone({ success: true, message: '版本分段计划已生成…' });
    } catch {
      onDone({ success: false, message: '版本分段计划生成失败，请稍后重试' });
    }
  }
}
```

**V1 子集透传链路**：确认计划时用户可调整勾选 → `project:confirm-plan` 把调整后的计划写入 `ProjectMeta.versionPlan` → `Developer` 读取同一 `versionPlan`，仅把 `versions[0].features` 作为本次开发范围（其余功能不实现，后续对话中说"开发 V2"再逐步完善）。



## 五、核心数据流

### 5.1 完整用户旅程数据流

```
用户输入想法
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 渲染进程 → 主进程 (IPC)                                        │
│ { type: 'CHAT_MESSAGE', payload: { text: '我想做个记账工具' } } │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程 → DSH 子进程 (stdin)                                    │
│ 注入用户消息，驱动 AI 助理对话                                  │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ DSH 子进程 → 主进程 (stdout)                                   │
│ 输出 AI 助理的回复                                             │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程 → 渲染进程 (IPC)                                        │
│ 翻译后的用户友好消息                                           │
└─────────────────────────────────────────────────────────────────┘
    ↓
用户看到 AI 回复
```

### 5.2 信号拦截数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ DSH 子进程输出技术信号                                          │
│ [Agent] 检测到数据库需求，请提供连接信息                        │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 信号拦截器匹配规则                                              │
│ pattern: /数据库/ → category: 'question'                       │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 翻译器生成用户友好消息                                          │
│ { message: '您的项目需要保存数据，我来帮您配置',                │
│   suggestions: ['使用本地 SQLite', '稍后配置'] }                │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程 → 渲染进程 (IPC)                                        │
│ 推送翻译后的消息 + 选项按钮                                     │
└─────────────────────────────────────────────────────────────────┘
    ↓
用户看到友好的提示和可点击的选项
```

### 5.3 预览与修改数据流

```
用户悬停预览页面元素
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 渲染进程（预览 WebView）捕获 DOM 信息                           │
│ { tag: 'h1', content: '欢迎', styles: { color: '#1A2B3C' } }  │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 渲染进程 → 主进程 (IPC)                                        │
│ { type: 'ELEMENT_SELECTED', payload: elementInfo }             │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程调用 AI 助理生成反馈                                      │
│ '您正在查看主标题，它目前是深蓝色、32号字'                       │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程 → 渲染进程 (IPC)                                        │
│ 显示元素信息和可调整选项                                        │
└─────────────────────────────────────────────────────────────────┘
    ↓
用户看到右侧面板显示元素属性和调整控件
```

### 5.4 导出部署包数据流

```
用户点击"导出部署包"
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 渲染进程 → 主进程 (IPC)                                        │
│ { type: 'EXPORT_PROJECT', payload: { projectId: 'xxx' } }     │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程：从本地存储读取项目代码                                   │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程：生成部署包                                              │
│ - 复制源码                                                     │
│ - 生成 Dockerfile                                              │
│ - 生成 docker-compose.yml                                      │
│ - 生成部署指引文档                                              │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程：打包为 .zip 文件                                        │
│ 保存到 ~/.freecoder/projects/{id}/exports/                     │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程 → 渲染进程 (IPC)                                        │
│ { type: 'EXPORT_COMPLETE', payload: { path: '/path/to/zip' } }│
└─────────────────────────────────────────────────────────────────┘
    ↓
用户获得部署包，系统提示下载位置
```


### 5.5 版本分段与开发数据流

```
用户点击需求卡片「确认需求，规划版本」
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 渲染进程 → 主进程 (IPC)                                        │
│ { channel: 'project:confirm', projectId }                      │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程：状态 draft → planned                                   │
│ 后台异步调用 VersionPlanner.generatePlan（IPC 立即返回）        │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ VersionPlanner → DSH 子进程 (版本分段任务)                     │
│ AI 返回版本计划 JSON；失败/无效 → 兜底计划（V1=首个功能）       │
│ 计划写入 ProjectMeta.versionPlan                               │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 渲染进程：planned 状态下每 2s 轮询 project:get                  │
│ 拿到 versionPlan 后停止轮询，展示版本分段计划卡片              │
└─────────────────────────────────────────────────────────────────┘
    ↓
用户勾选调整 V1 功能范围，点击「确认计划，开始开发 V1」
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 渲染进程 → 主进程 (IPC)                                        │
│ { channel: 'project:confirm-plan', projectId, plan }           │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 主进程：状态 planned → developing                              │
│ 保存调整后的计划 → 后台调用 Developer 只开发 V1 子集            │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Developer → DSH 子进程 (开发任务，coreFeatures 仅含 V1 功能)    │
│ 完成 → 主进程推送 chat:signal，状态 developing → ready          │
└─────────────────────────────────────────────────────────────────┘
    ↓
用户进入预览视图
```

**防御要点**（详见第七章）：IPC 层对 `project:confirm` 做幂等守卫、对 `project:confirm-plan` 做 V1 结构校验；`generatePlan` 任何异常都必须回调 `onDone`，否则渲染端轮询无终止。



## 六、进程通信设计

### 6.1 IPC 通信架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      渲染进程 (Renderer)                        │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │   React 组件  ←→  Zustand Store  ←→  API 调用           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                     window.electron.*                           │
│                              │                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    Preload 脚本                            │ │
│  │  暴露安全的 API，只允许白名单操作                          │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │ IPC
┌─────────────────────────────▼───────────────────────────────────┐
│                       主进程 (Main)                             │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              IPC 处理器 (ipc handlers)                     │ │
│  │  - chat.send    - preview.get   - export.start            │ │
│  │  - project.list  - settings.update  - ...                │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              业务逻辑层 (Orchestrator)                     │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 IPC 通道列表

| 通道名称 | 方向 | 用途 |
|---------|------|------|
| `chat:send` | 渲染 → 主 | 发送用户消息 |
| `chat:response` | 主 → 渲染 | 推送 AI 回复 |
| `chat:signal` | 主 → 渲染 | 推送 DSH 信号翻译 |
| `preview:start` | 渲染 → 主 | 启动预览 |
| `preview:update` | 主 → 渲染 | 预览状态更新 |
| `preview:element` | 渲染 → 主 | 预览元素选中信息 |
| `project:list` | 渲染 → 主 | 获取项目列表 |
| `project:create` | 渲染 → 主 | 创建新项目 |
| `project:get` | 渲染 → 主 | 读取项目详情（含需求与版本计划） |
| `project:confirm` | 渲染 → 主 | 确认需求 → 进入版本分段阶段（planned），后台生成版本计划 |
| `project:confirm-plan` | 渲染 → 主 | 确认版本分段计划 → 只开发 V1 并启动开发 |
| `project:delete` | 渲染 → 主 | 删除项目 |
| `project:select-location` | 渲染 → 主 | 弹出系统文件夹选择器（自定义保存位置） |
| `export:start` | 渲染 → 主 | 开始导出部署包 |
| `export:complete` | 主 → 渲染 | 导出完成通知 |
| `settings:get` | 渲染 → 主 | 获取设置 |
| `settings:update` | 渲染 → 主 | 更新设置 |
| `apikey:save` | 渲染 → 主 | 保存 API Key |
| `apikey:validate` | 渲染 → 主 | 验证 API Key |

### 6.3 Preload 暴露接口

```typescript
// preload/index.ts
contextBridge.exposeInMainWorld('electron', {
  // 对话
  chat: {
    send: (message: string) => ipcRenderer.invoke('chat:send', message),
    onResponse: (callback: (data: any) => void) => {
      ipcRenderer.on('chat:response', (_, data) => callback(data));
    },
    onSignal: (callback: (data: any) => void) => {
      ipcRenderer.on('chat:signal', (_, data) => callback(data));
    }
  },
  
  // 预览
  preview: {
    start: (projectId: string) => ipcRenderer.invoke('preview:start', projectId),
    stop: () => ipcRenderer.invoke('preview:stop'),
    onStatus: (callback: (status: any) => void) => {
      ipcRenderer.on('preview:status', (_, status) => callback(status));
    }
  },
  
  // 项目
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    create: (name: string) => ipcRenderer.invoke('project:create', name),
    delete: (id: string) => ipcRenderer.invoke('project:delete', id)
  },
  
  // 导出
  export: {
    start: (projectId: string) => ipcRenderer.invoke('export:start', projectId),
    onComplete: (callback: (path: string) => void) => {
      ipcRenderer.on('export:complete', (_, path) => callback(path));
    }
  },
  
  // 设置
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings: any) => ipcRenderer.invoke('settings:update', settings)
  },
  
  // API Key
  apikey: {
    save: (key: string) => ipcRenderer.invoke('apikey:save', key),
    validate: (key: string) => ipcRenderer.invoke('apikey:validate', key)
  }
});
```


## 七、防御性编程规范

面向非技术用户的流程中，任何一步卡死都会造成困惑。本规范约束主进程与渲染进程在**异常路径**上的行为，确保流程要么前进、要么给出明确反馈，绝不悬挂。

### 7.1 异步任务：回调必达

**规范**：后台异步任务（如版本计划生成、代码开发）必须保证结果回调 `onDone` **恰好被调用一次**，包括异常路径。

**已落地实现**（`main/dev/planner.ts`）：`generatePlan` 主体包在 `try/catch` 中，存储写入失败时也回调 `onDone({ success: false, ... })`，渲染端轮询因此有明确终止结果。

```typescript
async generatePlan(projectId, onDone): Promise<void> {
  try {
    // ... 计划生成与写入
    onDone({ success: true, message: '版本分段计划已生成…' });
  } catch {
    onDone({ success: false, message: '版本分段计划生成失败，请稍后重试' });
  }
}
```

**配套约束**：
- IPC 层对后台任务用 `void task(...).catch(() => undefined)` 兜底，杜绝 unhandled rejection（`main/ipc/project.ts`）
- 渲染端轮询必须有终止条件（拿到结果、阶段变更、组件卸载时清理定时器）

### 7.2 IPC 边界：幂等守卫

**规范**：会触发后台重任务（AI 调用、文件写入）的 IPC 通道必须**幂等**——同一项目在已推进状态下重复调用不得重复执行、不得回退状态。

**已落地实现**（`main/ipc/project.ts` 的 `project:confirm`）：

```typescript
// 幂等保护：已进入版本分段（或后续阶段）时不重复生成计划
if (project.status !== 'draft') {
  return { success: true };
}
```

**依据**：渲染端按钮虽会在确认后隐藏，但双击竞态、异常重试等路径仍可重复调用；主进程是 IPC 信任边界，不能依赖 UI 防重。

### 7.3 IPC 边界：输入结构校验

**规范**：主进程接收的复杂对象参数（如版本计划）必须校验**最小必要结构**，非法输入直接拒绝，避免静默降级造成错误业务行为。

**已落地实现**（`main/ipc/project.ts` 的 `project:confirm-plan`）：校验 V1 的 `label` 非空且 `features` 为非空数组；否则抛 `INVALID_PARAMS` 并保持原状态。

**背景**：若无此校验，`features: []` 的非法计划会让 `Developer` 静默回退为开发全部功能，与"只开发 V1"的产品预期不符。

### 7.4 确定性兜底

**规范**：依赖 AI 输出的功能（解析失败、进程异常）必须提供**确定性兜底方案**，保证流程不中断、不悬挂。

**已落地实现**（`main/dsh/structured.ts` 的 `fallbackVersionPlan`）：AI 未返回有效版本计划时，兜底为「V1=第一个核心功能，其余归 V2」，行为可预测、可测试。

### 7.5 规范速查

| 场景 | 必须做到 | 禁止 |
|------|---------|------|
| 后台异步任务 | 回调必达（成功/失败各一次） | 异常后无回调、悬挂 |
| 重任务 IPC | 状态幂等守卫 | 重复执行、状态回退 |
| 复杂 IPC 参数 | 最小结构校验 | 静默接受非法输入 |
| AI 输出解析 | 确定性兜底 | 解析失败即中断流程 |
| 渲染端轮询 | 有终止条件 + 卸载清理 | 无限轮询无反馈 |

**检查清单**：新增后台任务时自查 ① 异常路径是否回调；② IPC 是否幂等；③ 复杂入参是否校验；④ AI 输出是否有兜底。


## 八、安全设计

### 8.1 安全原则

| 原则 | 说明 |
|------|------|
| **最小权限** | 渲染进程只拥有必要的权限，敏感操作由主进程执行 |
| **数据本地优先** | 所有数据存储在本地，不上传任何服务器 |
| **加密敏感信息** | API Key 使用 Electron safeStorage 加密 |
| **沙箱隔离** | DSH 运行在独立子进程，代码生成在沙箱环境 |
| **无遥测** | 不收集任何用户数据，不发送分析信息 |

### 8.2 安全措施

| 风险 | 措施 |
|------|------|
| API Key 泄露 | 使用系统级加密存储（safeStorage），明文仅在内存中存在 |
| 恶意代码执行 | DSH 沙箱隔离，文件系统操作限制在项目目录内 |
| 用户隐私泄露 | 不上传任何数据，代码只在本地运行 |
| 未经授权的进程访问 | 使用 Electron 的 contextBridge 隔离，只暴露白名单 API |
| 跨站脚本攻击 | 预览 WebView 开启沙箱模式，禁用 Node.js 集成 |

### 8.3 安全审计清单

- [ ] API Key 加密存储验证
- [ ] IPC 通道权限检查
- [ ] DSH 子进程权限限制
- [ ] 预览 WebView 沙箱隔离
- [ ] 日志中敏感信息脱敏
- [ ] 无用户数据上传验证


## 九、构建与发布

### 9.1 构建配置（electron-builder.yml）

```yaml
appId: com.freecoder.app
productName: FreeCoder
copyright: Copyright © 2026 FreeCoder

directories:
  output: dist

files:
  - dist/**/*
  - resources/**/*

extraResources:
  - from: resources/node
    to: node
  - from: resources/dsh
    to: dsh

win:
  target: 
    - target: nsis
    - target: portable
  icon: resources/icons/icon.ico

mac:
  category: public.app-category.developer-tools
  icon: resources/icons/icon.icns
  target:
    - dmg
    - zip

linux:
  target:
    - AppImage
    - deb
  icon: resources/icons/icon.png

nsis:
  oneClick: false
  perMachine: true
```

### 9.2 打包大小估算

| 平台 | 预估大小 | 说明 |
|------|---------|------|
| Windows (NSIS) | ~120 MB | 含 Electron + Node + DSH |
| macOS (DMG) | ~130 MB | 含 Electron + Node + DSH |
| Linux (AppImage) | ~110 MB | 含 Electron + Node + DSH |

### 9.3 开发模式

```bash
# 安装依赖
pnpm install

# 启动开发模式（同时启动 Vite + Electron）
pnpm dev

# 构建
pnpm build

# 打包
pnpm package
```


## 十、性能指标

### 10.1 目标性能

| 指标 | 目标值 |
|------|--------|
| 应用启动时间 | < 5 秒 |
| DSH 进程启动 | < 3 秒 |
| 预览加载时间 | < 3 秒 |
| 修改响应时间 | < 5 秒 |
| 内存占用（空闲） | < 200 MB |
| 内存占用（运行中） | < 500 MB |
| 磁盘占用（安装） | < 200 MB |
| 导出包生成 | < 10 秒 |

### 10.2 性能优化策略

| 策略 | 说明 |
|------|------|
| 懒加载 | React 组件按需加载 |
| 虚拟滚动 | 对话列表使用虚拟滚动渲染 |
| 进程隔离 | DSH 子进程独立运行，不阻塞 UI |
| 缓存 | 页面元素分析结果缓存，减少重复计算 |


## 十一、版本历史

| 版本 | 日期 | 变更说明 |
|------|------|---------|
| v1.1 | 2026-08-21 | 新增版本分段模块（4.2.6）与版本分段数据流（5.5）；IPC 通道补充 `project:confirm` / `project:confirm-plan`；新增第七章「防御性编程规范」（回调必达、IPC 幂等、输入校验、确定性兜底） |
| v1.0 | 2026-08-19 | 初始版本，覆盖 0.1.x 完整技术架构 |


**文档结束**

---
