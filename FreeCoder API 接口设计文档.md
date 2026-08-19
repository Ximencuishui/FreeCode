# FreeCoder API 接口设计文档

**版本**：1.0
**状态**：定稿
**更新日期**：2026-08-19
**适用版本**：FreeCoder 0.1.x


## 一、文档说明

### 1.1 文档目的
本文档定义 FreeCoder 桌面应用中**渲染进程与主进程之间**的所有 IPC 通信接口，包括请求-响应型接口和事件推送型接口。

### 1.2 适用范围
- 渲染进程（React 应用）调用主进程（Electron）的接口
- 主进程向渲染进程推送事件的接口
- 所有接口均通过 Preload 脚本暴露

### 1.3 相关文档
- FreeCoder 技术架构设计文档 v1.0
- FreeCoder 前端设计说明书 v1.0


## 二、通信架构

### 2.1 通信方式

FreeCoder 采用两种 IPC 通信模式：

| 模式 | 方法 | 适用场景 |
|------|------|---------|
| **请求-响应** | `ipcRenderer.invoke()` + `ipcMain.handle()` | 需要返回结果的同步/异步调用 |
| **事件推送** | `ipcRenderer.on()` + `ipcMain.send()` | 主进程主动推送状态更新 |

### 2.2 安全隔离

所有 IPC 接口通过 **Preload 脚本** 暴露，渲染进程无法直接访问 Node.js 或 Electron API。

```typescript
// preload/index.ts
contextBridge.exposeInMainWorld('electron', {
  // 只暴露白名单接口
  chat: { ... },
  preview: { ... },
  // ...
});
```

### 2.3 通信流程图

```
┌─────────────┐    invoke    ┌─────────────┐
│   渲染进程   │ ──────────→ │   主进程    │
│  (Renderer) │ ←────────── │   (Main)    │
└─────────────┘   resolve   └─────────────┘
       │                              │
       │         send + on            │
       │ ←─────────────────────────────│
       │      (事件推送)               │
       │                              │
```


## 三、接口分类总览

| 分类 | 接口数量 | 说明 |
|------|---------|------|
| 对话接口 | 4 个 | 用户消息发送、AI 响应、信号推送 |
| 预览接口 | 5 个 | 预览启动/停止、元素选中、状态更新 |
| 项目管理接口 | 4 个 | 项目创建、列表、删除、读取 |
| 导出接口 | 2 个 | 导出部署包 |
| 设置接口 | 2 个 | 获取/更新设置 |
| API Key 接口 | 2 个 | 保存/验证 API Key |
| 应用接口 | 2 个 | 应用信息、退出 |
| **合计** | **21 个** | |


## 四、接口详细设计

### 4.1 对话接口（Chat）

#### 4.1.1 发送用户消息

| 属性 | 值 |
|------|-----|
| **通道名** | `chat:send` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface ChatSendParams {
  projectId: string;    // 项目 ID
  message: string;      // 用户消息内容
  attachments?: {       // 可选：附件（截图等）
    type: 'image' | 'file';
    data: string;       // base64 或路径
  }[];
}
```

**返回值**：

```typescript
interface ChatSendResult {
  success: boolean;
  messageId?: string;   // 消息 ID
  error?: string;       // 错误信息
}
```

**示例**：

```typescript
// 渲染进程调用
const result = await window.electron.chat.send({
  projectId: 'proj_abc123',
  message: '我想做个记账工具'
});
```

**错误码**：

| 错误码 | 说明 |
|--------|------|
| `PROJECT_NOT_FOUND` | 项目不存在 |
| `API_KEY_INVALID` | API Key 无效 |
| `DSH_NOT_RUNNING` | DSH 进程未启动 |
| `MESSAGE_EMPTY` | 消息为空 |


#### 4.1.2 接收 AI 响应（事件推送）

| 属性 | 值 |
|------|-----|
| **通道名** | `chat:response` |
| **方向** | 主进程 → 渲染进程 |
| **模式** | 事件推送（on） |

**事件数据**：

```typescript
interface ChatResponseEvent {
  type: 'message' | 'thinking' | 'done' | 'error';
  content?: string;         // 消息内容
  messageId?: string;
  isComplete?: boolean;     // 是否完整消息
  timestamp: string;
}
```

**示例**：

```typescript
// 渲染进程监听
window.electron.chat.onResponse((data) => {
  if (data.type === 'message') {
    // 追加到对话流
    appendToChat(data.content);
  } else if (data.type === 'done') {
    // 消息结束
    setProcessing(false);
  }
});
```


#### 4.1.3 接收 DSH 信号翻译（事件推送）

| 属性 | 值 |
|------|-----|
| **通道名** | `chat:signal` |
| **方向** | 主进程 → 渲染进程 |
| **模式** | 事件推送（on） |

**事件数据**：

```typescript
interface SignalEvent {
  type: 'info' | 'warning' | 'error' | 'question';
  message: string;           // 翻译后的用户友好消息
  suggestions?: string[];    // 建议选项
  code?: string;            // 原始技术信息（可选）
  timestamp: string;
}
```

**示例**：

```typescript
// 渲染进程监听
window.electron.chat.onSignal((signal) => {
  // 在对话中插入信号消息
  insertSignalMessage(signal.message, signal.suggestions);
});
```


#### 4.1.4 获取对话历史

| 属性 | 值 |
|------|-----|
| **通道名** | `chat:history` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface ChatHistoryParams {
  projectId: string;
  limit?: number;           // 限制条数，默认 50
}
```

**返回值**：

```typescript
interface ChatHistoryResult {
  messages: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
  }[];
}
```


### 4.2 预览接口（Preview）

#### 4.2.1 启动预览

| 属性 | 值 |
|------|-----|
| **通道名** | `preview:start` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface PreviewStartParams {
  projectId: string;
}
```

**返回值**：

```typescript
interface PreviewStartResult {
  success: boolean;
  url?: string;             // 预览访问地址（如 http://localhost:3000）
  port?: number;
  error?: string;
}
```

**示例**：

```typescript
const result = await window.electron.preview.start({
  projectId: 'proj_abc123'
});
// result.url = 'http://localhost:3000'
```


#### 4.2.2 停止预览

| 属性 | 值 |
|------|-----|
| **通道名** | `preview:stop` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：无

**返回值**：

```typescript
interface PreviewStopResult {
  success: boolean;
}
```


#### 4.2.3 预览状态更新（事件推送）

| 属性 | 值 |
|------|-----|
| **通道名** | `preview:status` |
| **方向** | 主进程 → 渲染进程 |
| **模式** | 事件推送（on） |

**事件数据**：

```typescript
interface PreviewStatusEvent {
  status: 'starting' | 'running' | 'stopped' | 'error';
  url?: string;
  progress?: number;        // 启动进度 0-100
  message?: string;         // 状态描述
}
```


#### 4.2.4 预览元素选中（渲染进程 → 主进程）

当用户在预览页面悬停或点击元素时，渲染进程将元素信息发送给主进程。

| 属性 | 值 |
|------|-----|
| **通道名** | `preview:element` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface ElementSelectParams {
  element: {
    tag: string;            // 标签名，如 'h1'
    id?: string;
    className?: string;
    content: string;        // 文本内容
    selector: string;       // CSS 选择器
    styles: {
      color?: string;
      fontSize?: string;
      fontWeight?: string;
      backgroundColor?: string;
      margin?: string;
      padding?: string;
      borderRadius?: string;
      // ... 更多样式属性
    };
    position: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
}
```

**返回值**：

```typescript
interface ElementSelectResult {
  success: boolean;
  elementInfo?: {
    name: string;           // 友好名称，如 "主标题"
    description: string;    // 描述
    suggestedActions: {     // 建议的操作
      label: string;
      action: string;
    }[];
  };
}
```


#### 4.2.5 预览刷新

| 属性 | 值 |
|------|-----|
| **通道名** | `preview:refresh` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：无

**返回值**：

```typescript
interface PreviewRefreshResult {
  success: boolean;
}
```


### 4.3 项目管理接口（Project）

#### 4.3.1 获取项目列表

| 属性 | 值 |
|------|-----|
| **通道名** | `project:list` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：无

**返回值**：

```typescript
interface ProjectListResult {
  projects: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    status: 'draft' | 'developing' | 'ready' | 'exported';
  }[];
}
```


#### 4.3.2 创建项目

| 属性 | 值 |
|------|-----|
| **通道名** | `project:create` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface ProjectCreateParams {
  name: string;
  description?: string;
  template?: 'blank' | 'blog' | 'ecommerce' | 'tool';  // 项目模板
}
```

**返回值**：

```typescript
interface ProjectCreateResult {
  success: boolean;
  projectId?: string;
  projectPath?: string;     // 本地存储路径
  error?: string;
}
```


#### 4.3.3 删除项目

| 属性 | 值 |
|------|-----|
| **通道名** | `project:delete` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface ProjectDeleteParams {
  projectId: string;
  confirm: boolean;         // 二次确认，必须为 true
}
```

**返回值**：

```typescript
interface ProjectDeleteResult {
  success: boolean;
  error?: string;
}
```


#### 4.3.4 读取项目详情

| 属性 | 值 |
|------|-----|
| **通道名** | `project:get` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface ProjectGetParams {
  projectId: string;
}
```

**返回值**：

```typescript
interface ProjectGetResult {
  success: boolean;
  project?: {
    id: string;
    name: string;
    description: string;
    requirements: {
      goal: string;
      targetUsers: string;
      coreFeatures: string[];
      visualStyle: string;
      // ... 其他需求字段
    };
    status: 'draft' | 'developing' | 'ready' | 'exported';
    createdAt: string;
    updatedAt: string;
    chatHistory: any[];    // 对话历史
    codePath: string;      // 代码存储路径
  };
  error?: string;
}
```


### 4.4 导出接口（Export）

#### 4.4.1 开始导出部署包

| 属性 | 值 |
|------|-----|
| **通道名** | `export:start` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface ExportStartParams {
  projectId: string;
  includeDocker?: boolean;   // 是否包含 Docker 配置，默认 true
}
```

**返回值**：

```typescript
interface ExportStartResult {
  success: boolean;
  exportId?: string;         // 导出任务 ID（用于追踪进度）
  error?: string;
}
```


#### 4.4.2 导出完成通知（事件推送）

| 属性 | 值 |
|------|-----|
| **通道名** | `export:complete` |
| **方向** | 主进程 → 渲染进程 |
| **模式** | 事件推送（on） |

**事件数据**：

```typescript
interface ExportCompleteEvent {
  exportId: string;
  status: 'success' | 'failed';
  zipPath?: string;          // .zip 文件路径
  error?: string;
}
```


### 4.5 设置接口（Settings）

#### 4.5.1 获取设置

| 属性 | 值 |
|------|-----|
| **通道名** | `settings:get` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：无

**返回值**：

```typescript
interface SettingsGetResult {
  settings: {
    apiKeyConfigured: boolean;   // 是否已配置 API Key（不返回 Key 本身）
    projectsPath: string;        // 项目存储路径
    language: 'zh-CN' | 'en-US';
    darkMode: boolean;
    telemetryEnabled: boolean;   // 始终为 false（无遥测）
  };
}
```


#### 4.5.2 更新设置

| 属性 | 值 |
|------|-----|
| **通道名** | `settings:update` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface SettingsUpdateParams {
  projectsPath?: string;
  language?: 'zh-CN' | 'en-US';
  darkMode?: boolean;
}
```

**返回值**：

```typescript
interface SettingsUpdateResult {
  success: boolean;
  error?: string;
}
```


### 4.6 API Key 接口

#### 4.6.1 保存 API Key

| 属性 | 值 |
|------|-----|
| **通道名** | `apikey:save` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface ApiKeySaveParams {
  key: string;
}
```

**返回值**：

```typescript
interface ApiKeySaveResult {
  success: boolean;
  error?: string;
}
```

**安全说明**：
- Key 通过 Electron `safeStorage` 加密存储
- 明文 Key 仅在内存中短暂存在
- 存储路径：`~/.freecoder/api-key.encrypted`


#### 4.6.2 验证 API Key

| 属性 | 值 |
|------|-----|
| **通道名** | `apikey:validate` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：

```typescript
interface ApiKeyValidateParams {
  key: string;
}
```

**返回值**：

```typescript
interface ApiKeyValidateResult {
  valid: boolean;
  message?: string;          // 无效时的说明
}
```


### 4.7 应用接口（App）

#### 4.7.1 获取应用信息

| 属性 | 值 |
|------|-----|
| **通道名** | `app:info` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 请求-响应（invoke） |

**参数**：无

**返回值**：

```typescript
interface AppInfoResult {
  version: string;           // 应用版本
  platform: 'win32' | 'darwin' | 'linux';
  electron: string;          // Electron 版本
  dshVersion?: string;       // DSH 版本
}
```


#### 4.7.2 退出应用

| 属性 | 值 |
|------|-----|
| **通道名** | `app:quit` |
| **方向** | 渲染进程 → 主进程 |
| **模式** | 事件发送（send） |

**参数**：无

**说明**：通知主进程执行退出流程（先停止 DSH，再关闭窗口）。


## 五、错误码定义

### 5.1 通用错误码

| 错误码 | HTTP 类比 | 说明 |
|--------|----------|------|
| `SUCCESS` | 200 | 操作成功 |
| `UNKNOWN_ERROR` | 500 | 未知错误 |
| `INVALID_PARAMS` | 400 | 参数错误 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `UNAUTHORIZED` | 401 | 未授权（如 API Key 无效） |

### 5.2 业务错误码

| 错误码 | 说明 |
|--------|------|
| `PROJECT_NOT_FOUND` | 项目不存在 |
| `PROJECT_ALREADY_EXISTS` | 项目已存在 |
| `PROJECT_NAME_EMPTY` | 项目名称为空 |
| `DSH_NOT_RUNNING` | DSH 进程未启动 |
| `DSH_RUNNING` | DSH 进程已在运行 |
| `DSH_START_FAILED` | DSH 启动失败 |
| `API_KEY_INVALID` | API Key 无效 |
| `API_KEY_MISSING` | API Key 未配置 |
| `PREVIEW_NOT_RUNNING` | 预览未启动 |
| `PREVIEW_ALREADY_RUNNING` | 预览已在运行 |
| `EXPORT_FAILED` | 导出失败 |
| `FILE_IO_ERROR` | 文件读写错误 |

### 5.3 统一错误响应格式

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: string;            // 错误码
    message: string;         // 用户友好的错误信息
    details?: any;           // 调试信息（可选）
  };
}
```

**示例**：

```json
{
  "success": false,
  "error": {
    "code": "API_KEY_INVALID",
    "message": "API Key 无效，请检查设置后重试"
  }
}
```


## 六、前端调用示例

### 6.1 使用示例

```typescript
// 发送消息
const sendMessage = async (text: string) => {
  try {
    const result = await window.electron.chat.send({
      projectId: currentProjectId,
      message: text
    });
    
    if (!result.success) {
      showError(result.error);
    }
  } catch (err) {
    showError('发送失败，请重试');
  }
};

// 监听 AI 响应
useEffect(() => {
  const unsubscribe = window.electron.chat.onResponse((data) => {
    if (data.type === 'message') {
      appendMessage('assistant', data.content);
    } else if (data.type === 'done') {
      setProcessing(false);
    }
  });
  
  return unsubscribe;
}, []);

// 监听信号
useEffect(() => {
  const unsubscribe = window.electron.chat.onSignal((signal) => {
    insertSignalMessage(signal.message, signal.suggestions);
  });
  
  return unsubscribe;
}, []);
```

### 6.2 TypeScript 类型声明

```typescript
// types/electron.d.ts
declare global {
  interface Window {
    electron: {
      chat: {
        send: (params: ChatSendParams) => Promise<ChatSendResult>;
        onResponse: (callback: (data: ChatResponseEvent) => void) => () => void;
        onSignal: (callback: (data: SignalEvent) => void) => () => void;
        getHistory: (params: ChatHistoryParams) => Promise<ChatHistoryResult>;
      };
      preview: {
        start: (params: PreviewStartParams) => Promise<PreviewStartResult>;
        stop: () => Promise<PreviewStopResult>;
        refresh: () => Promise<PreviewRefreshResult>;
        onStatus: (callback: (data: PreviewStatusEvent) => void) => () => void;
        selectElement: (params: ElementSelectParams) => Promise<ElementSelectResult>;
      };
      project: {
        list: () => Promise<ProjectListResult>;
        create: (params: ProjectCreateParams) => Promise<ProjectCreateResult>;
        delete: (params: ProjectDeleteParams) => Promise<ProjectDeleteResult>;
        get: (params: ProjectGetParams) => Promise<ProjectGetResult>;
      };
      export: {
        start: (params: ExportStartParams) => Promise<ExportStartResult>;
        onComplete: (callback: (data: ExportCompleteEvent) => void) => () => void;
      };
      settings: {
        get: () => Promise<SettingsGetResult>;
        update: (params: SettingsUpdateParams) => Promise<SettingsUpdateResult>;
      };
      apikey: {
        save: (params: ApiKeySaveParams) => Promise<ApiKeySaveResult>;
        validate: (params: ApiKeyValidateParams) => Promise<ApiKeyValidateResult>;
      };
      app: {
        getInfo: () => Promise<AppInfoResult>;
        quit: () => void;
      };
    };
  }
}
```


## 七、接口清单

| 分类 | 接口名 | 方向 | 模式 |
|------|--------|------|------|
| Chat | `chat:send` | 渲染→主 | invoke |
| Chat | `chat:response` | 主→渲染 | on |
| Chat | `chat:signal` | 主→渲染 | on |
| Chat | `chat:history` | 渲染→主 | invoke |
| Preview | `preview:start` | 渲染→主 | invoke |
| Preview | `preview:stop` | 渲染→主 | invoke |
| Preview | `preview:status` | 主→渲染 | on |
| Preview | `preview:element` | 渲染→主 | invoke |
| Preview | `preview:refresh` | 渲染→主 | invoke |
| Project | `project:list` | 渲染→主 | invoke |
| Project | `project:create` | 渲染→主 | invoke |
| Project | `project:delete` | 渲染→主 | invoke |
| Project | `project:get` | 渲染→主 | invoke |
| Export | `export:start` | 渲染→主 | invoke |
| Export | `export:complete` | 主→渲染 | on |
| Settings | `settings:get` | 渲染→主 | invoke |
| Settings | `settings:update` | 渲染→主 | invoke |
| ApiKey | `apikey:save` | 渲染→主 | invoke |
| ApiKey | `apikey:validate` | 渲染→主 | invoke |
| App | `app:info` | 渲染→主 | invoke |
| App | `app:quit` | 渲染→主 | send |


## 八、版本历史

| 版本 | 日期 | 变更说明 |
|------|------|---------|
| v1.0 | 2026-08-19 | 初始版本，定义 21 个核心接口 |


**文档结束**

---
