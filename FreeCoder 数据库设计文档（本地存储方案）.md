# FreeCoder 数据库设计文档（本地存储方案）

**版本**：2.0  
**状态**：定稿  
**更新日期**：2026-08-21  
**适用版本**：FreeCoder 0.1.x


## 一、文档说明

### 1.1 文档目的
本文档定义 FreeCoder 桌面应用中**所有本地数据的存储结构**，包括项目文件、对话历史、用户设置、API Key 等的存储格式和读写规范。同时定义**生成应用的后端运行时存储方案**。

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| **双层存储架构** | FreeCoder 本体使用 JSON 文件存储；生成的应用后端使用 SQLite（sql.js WASM） |
| **人类可读** | FreeCoder 本体的 JSON 文件格式化存储，用户可用文本编辑器打开查看 |
| **并发安全** | 生成应用后端使用 SQLite 保证多请求并发下的数据一致性 |
| **原子操作** | 写入操作先写临时文件，再重命名替换，防止数据损坏 |
| **版本兼容** | 存储结构包含版本号，支持未来升级迁移；提供 JSON→SQLite 迁移脚本 |

### 1.3 相关文档
- FreeCoder 技术架构设计文档 v1.0
- FreeCoder API 接口设计文档 v1.0


## 二、存储路径结构

### 2.1 根目录

```
~/.freecoder/                        # FreeCoder 根目录
├── settings.json                    # 用户设置
├── api-key.encrypted                # 加密后的 API Key
├── projects/                        # 所有项目
│   └── {project-id}/                # 单个项目目录
│       ├── meta.json                # 项目元数据
│       ├── requirements.json        # 需求卡片数据
│       ├── chat-history.json        # 对话历史
│       ├── code/                    # 项目代码（DSH 生成）
│       │   ├── src/
│       │   ├── public/
│       │   └── package.json
│       └── exports/                 # 导出的部署包
│           └── {timestamp}.zip
├── logs/                            # 日志文件
│   ├── dsh.log                      # DSH 运行日志
│   └── freecoder.log                # 应用日志
└── tmp/                             # 临时文件
    ├── export-{timestamp}/          # 导出临时目录
    └── preview-{project-id}/        # 预览临时文件
```

### 2.2 项目 ID 生成规则

- 格式：`{timestamp}-{随机字符串}`
- 示例：`20260819T143022-abc123def`
- 长度：24-32 字符
- 保证唯一性


## 三、数据格式定义

### 3.1 用户设置（settings.json）

**存储路径**：`~/.freecoder/settings.json`

**Schema**：

```typescript
interface Settings {
  version: '1.0';                    // 设置版本号
  projectsPath: string;              // 项目存储路径，默认 ~/.freecoder/projects
  language: 'zh-CN' | 'en-US';       // 界面语言
  darkMode: boolean;                 // 深色模式
  telemetryEnabled: false;           // 固定为 false（无遥测）
  /** 大模型提供商（默认 DeepSeek 官方） */
  provider: 'deepseek' | 'openai-compatible';
  /** 自定义接口 Base URL（如 https://api.deepseek.com） */
  baseUrl?: string;
  /** 模型名（如 deepseek-chat） */
  model?: string;
  preview: {
    autoOpen: boolean;               // 代码生成后自动打开预览
    portRange: [number, number];     // 预览端口范围，默认 [3000, 3010]
  };
  export: {
    includeDocker: boolean;          // 导出时默认包含 Docker 配置
    includeReadme: boolean;          // 导出时默认包含部署指引
  };
  lastOpenedProject?: string;        // 上次打开的项目 ID
  firstLaunch: boolean;              // 是否首次启动
  updatedAt: string;                 // 最后更新时间（ISO 8601）
}
```

**默认值**：

```json
{
  "version": "1.0",
  "projectsPath": "~/.freecoder/projects",
  "language": "zh-CN",
  "darkMode": false,
  "telemetryEnabled": false,
  "provider": "deepseek",
  "baseUrl": "",
  "model": "",
  "preview": {
    "autoOpen": true,
    "portRange": [3000, 3010]
  },
  "export": {
    "includeDocker": true,
    "includeReadme": true
  },
  "firstLaunch": true,
  "updatedAt": "2026-08-19T14:30:22.000Z"
}
```

> **v2.0 变更**：新增 `provider`、`baseUrl`、`model` 字段，支持 DeepSeek 官方及 OpenAI 兼容自定义接口。


### 3.2 API Key 存储（api-key.encrypted）

**存储路径**：`~/.freecoder/api-key.encrypted`

- **格式**：Base64 编码的加密字符串
- **加密方式**：优先使用 Electron `safeStorage.encryptString()`；若不可用则降级为本地 Base64 存储并告警
- **解密方式**：Electron `safeStorage.decryptString()` 或 Base64 解码（降级模式）
- **明文不落盘**：解密后的 Key 只在内存中存在

**存储示例**（Base64 编码后）：

```
dGVzdC1rZXktdmFsdWUtZm9yLWRlbW9uc3RyYXRpb24tcHVycG9zZXM=
```

> **v2.0 变更**：新增加密降级机制，当 `safeStorage` 不可用时自动切换为 Base64 存储并在 UI 显示安全警告。


### 3.3 项目元数据（meta.json）

**存储路径**：`~/.freecoder/projects/{project-id}/meta.json`

**Schema**：

```typescript
interface ProjectMeta {
  id: string;                        // 项目 ID
  name: string;                      // 项目名称
  description?: string;              // 项目描述
  status: 'draft' | 'developing' | 'ready' | 'exported';
                                     // 状态：草稿/开发中/就绪/已导出
  template?: 'blank' | 'blog' | 'ecommerce' | 'tool';
  createdAt: string;                 // 创建时间（ISO 8601）
  updatedAt: string;                 // 最后更新时间（ISO 8601）
  lastOpenedAt: string;              // 最后打开时间（ISO 8601）
  codePath: string;                  // 代码存储路径（相对于项目目录）
  previewPort?: number;              // 预览端口
  exportCount: number;               // 导出次数
  totalChatMessages: number;         // 总对话消息数
}
```

**示例**：

```json
{
  "id": "20260819T143022-abc123def",
  "name": "我的记账本",
  "description": "个人使用的收支记录工具",
  "status": "developing",
  "template": "tool",
  "createdAt": "2026-08-19T14:30:22.000Z",
  "updatedAt": "2026-08-19T15:45:10.000Z",
  "lastOpenedAt": "2026-08-19T15:45:10.000Z",
  "codePath": "./code",
  "previewPort": 3000,
  "exportCount": 0,
  "totalChatMessages": 24
}
```


### 3.4 需求卡片（requirements.json）

**存储路径**：`~/.freecoder/projects/{project-id}/requirements.json`

**Schema**：

```typescript
interface Requirements {
  projectId: string;                 // 关联的项目 ID
  version: '1.0';                    // 需求格式版本
  confirmed: boolean;                // 是否已确认
  confirmedAt?: string;              // 确认时间
  
  // 需求内容
  goal: string;                      // 一句话目标
  targetUsers: string;               // 目标用户
  coreFeatures: string[];            // 核心功能列表
  useScenarios?: string;             // 使用场景
  dataRequirements?: string[];       // 数据需求
  visualStyle?: string;              // 视觉风格
  platform?: 'web' | 'mini-program' | 'both';
  authentication?: 'none' | 'password' | 'wechat' | 'sms';
  
  // 需求变更历史
  history: {
    version: number;
    timestamp: string;
    changes: string;                 // 变更描述
  }[];
  
  updatedAt: string;                 // 最后更新时间
}
```

**示例**：

```json
{
  "projectId": "20260819T143022-abc123def",
  "version": "1.0",
  "confirmed": true,
  "confirmedAt": "2026-08-19T15:10:00.000Z",
  "goal": "个人使用的收支记录工具",
  "targetUsers": "个人使用，记录日常消费",
  "coreFeatures": [
    "记录每日收入和支出",
    "按月份分类统计",
    "导出月度报表"
  ],
  "useScenarios": "每天记录个人消费，月底查看支出分类",
  "dataRequirements": ["收支金额", "分类标签", "日期时间"],
  "visualStyle": "简洁、清爽、适合个人使用",
  "platform": "web",
  "authentication": "none",
  "history": [
    {
      "version": 1,
      "timestamp": "2026-08-19T14:30:22.000Z",
      "changes": "初始创建"
    },
    {
      "version": 2,
      "timestamp": "2026-08-19T15:10:00.000Z",
      "changes": "确认需求"
    }
  ],
  "updatedAt": "2026-08-19T15:10:00.000Z"
}
```


### 3.5 对话历史（chat-history.json）

**存储路径**：`~/.freecoder/projects/{project-id}/chat-history.json`

**Schema**：

```typescript
interface ChatHistory {
  projectId: string;
  messages: ChatMessage[];
  updatedAt: string;
}

interface ChatMessage {
  id: string;                        // 消息 ID，格式：msg-{timestamp}-{random}
  role: 'user' | 'assistant' | 'system' | 'signal';
  content: string;                   // 消息内容
  signal?: {                         // 如果是信号类型
    type: 'info' | 'warning' | 'error' | 'question';
    suggestions?: string[];
    original?: string;               // 原始 DSH 信号（可选）
  };
  metadata?: {
    elementInfo?: any;               // 预览元素信息（用户点击时）
    exportInfo?: any;                // 导出相关信息
  };
  timestamp: string;                 // ISO 8601
  isComplete: boolean;               // 是否完整消息（流式消息）
}
```

**示例**：

```json
{
  "projectId": "20260819T143022-abc123def",
  "messages": [
    {
      "id": "msg-20260819T143022-001",
      "role": "user",
      "content": "我想做个记账工具",
      "timestamp": "2026-08-19T14:30:22.000Z",
      "isComplete": true
    },
    {
      "id": "msg-20260819T143030-002",
      "role": "assistant",
      "content": "您好！我来帮您梳理需求。谁会用这个记账工具呢？",
      "timestamp": "2026-08-19T14:30:30.000Z",
      "isComplete": true
    },
    {
      "id": "msg-20260819T143100-003",
      "role": "system",
      "content": "检测到数据库需求，已自动配置本地 SQLite",
      "timestamp": "2026-08-19T14:31:00.000Z",
      "isComplete": true
    }
  ],
  "updatedAt": "2026-08-19T15:45:10.000Z"
}
```


### 3.6 导出包结构

**存储位置**：`~/.freecoder/projects/{project-id}/exports/{timestamp}.zip`

**压缩包内部结构**：

```
freecoder-deploy-{timestamp}.zip
├── README.md                        # 部署指引文档
├── deploy-guide.html                # 图文并茂的部署指南
├── docker-compose.yml               # Docker Compose 配置
├── Dockerfile                       # Docker 镜像配置
├── .env.example                     # 环境变量示例
├── app/                             # 应用代码
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
└── database/
    └── schema.sql                   # 数据库初始化脚本（如需要）
```


## 四、存储模块接口

### 4.1 StorageManager 接口

```typescript
// main/storage/index.ts
interface StorageManager {
  // ========== 初始化 ==========
  init(): Promise<void>;              // 初始化存储目录
  
  // ========== 项目管理 ==========
  createProject(name: string, options?: ProjectCreateOptions): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  listProjects(): Promise<ProjectMeta[]>;
  deleteProject(id: string): Promise<void>;
  updateProjectMeta(id: string, updates: Partial<ProjectMeta>): Promise<void>;
  
  // ========== 需求管理 ==========
  saveRequirements(projectId: string, requirements: Requirements): Promise<void>;
  getRequirements(projectId: string): Promise<Requirements | null>;
  confirmRequirements(projectId: string): Promise<void>;
  
  // ========== 对话管理 ==========
  saveChatMessage(projectId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage>;
  getChatHistory(projectId: string, limit?: number): Promise<ChatMessage[]>;
  clearChatHistory(projectId: string): Promise<void>;
  appendChatMessage(projectId: string, message: Partial<ChatMessage>): Promise<void>;
  
  // ========== 设置管理 ==========
  getSettings(): Promise<Settings>;
  saveSettings(settings: Partial<Settings>): Promise<void>;
  
  // ========== API Key 管理 ==========
  saveApiKey(key: string): Promise<void>;
  loadApiKey(): Promise<string | null>;
  
  // ========== 导出管理 ==========
  createExportPackage(projectId: string, options?: ExportOptions): Promise<string>;
  
  // ========== 项目管理 ==========
  getProjectCodePath(projectId: string): string;
  ensureProjectDirectories(projectId: string): Promise<void>;
}
```

### 4.2 核心实现要点

#### 4.2.1 对话历史的增量写入

对话历史采用**追加模式**，避免每次新消息都重写整个文件：

```typescript
// main/storage/session.ts
export async function appendChatMessage(
  projectId: string, 
  message: ChatMessage
): Promise<void> {
  const filePath = getChatHistoryPath(projectId);
  
  // 读取现有数据
  let history: ChatHistory;
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    history = JSON.parse(content);
  } catch {
    history = { projectId, messages: [] };
  }
  
  // 追加消息
  history.messages.push(message);
  history.updatedAt = new Date().toISOString();
  
  // 写入（原子操作）
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(history, null, 2));
  await fs.rename(tmpPath, filePath);
}
```

#### 4.2.2 对话历史的分页与归档

为控制单文件大小，当对话消息超过 1000 条时自动归档：

```typescript
const MAX_MESSAGES_PER_FILE = 1000;

export async function getChatHistory(
  projectId: string,
  limit: number = 50
): Promise<ChatMessage[]> {
  const history = await loadFullHistory(projectId);
  
  // 如果消息数量超过限制，进行归档
  if (history.messages.length > MAX_MESSAGES_PER_FILE) {
    await archiveOldMessages(projectId, history);
    // 重新加载
    return getChatHistory(projectId, limit);
  }
  
  // 返回最新的 limit 条
  return history.messages.slice(-limit);
}
```


## 五、数据迁移策略

### 5.1 版本管理

所有数据文件包含 `version` 字段，支持未来升级：

| 版本 | 变更内容 | 迁移方式 |
|------|---------|---------|
| 1.0 | 初始版本 | - |
| 1.1 | 新增字段 | 自动填充默认值 |
| 2.0 | 重大结构变更 | 提供迁移脚本 |


### 5.2 迁移示例

```typescript
// main/storage/migration.ts
export async function migrateSettings(settings: any): Promise<Settings> {
  const version = settings.version || '0.0';
  
  switch (version) {
    case '0.0':
      // 从旧版升级到 1.0
      return {
        version: '1.0',
        projectsPath: settings.projectsPath || '~/.freecoder/projects',
        language: settings.language || 'zh-CN',
        darkMode: settings.darkMode || false,
        telemetryEnabled: false,
        preview: {
          autoOpen: true,
          portRange: [3000, 3010]
        },
        export: {
          includeDocker: true,
          includeReadme: true
        },
        firstLaunch: false,
        updatedAt: new Date().toISOString()
      };
    
    case '1.0':
      // 保持现状
      return settings;
    
    default:
      return settings;
  }
}
```


## 六、安全存储

### 6.1 API Key 加密

```typescript
// main/security/encryption.ts
import { safeStorage } from 'electron';
import fs from 'fs-extra';

const API_KEY_PATH = path.join(getFreeCoderDir(), 'api-key.encrypted');

export async function saveApiKey(key: string): Promise<void> {
  const encrypted = safeStorage.encryptString(key);
  await fs.writeFile(API_KEY_PATH, encrypted.toString('base64'));
}

export async function loadApiKey(): Promise<string | null> {
  try {
    const content = await fs.readFile(API_KEY_PATH, 'utf-8');
    const encrypted = Buffer.from(content, 'base64');
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}
```

### 6.2 敏感信息脱敏

日志和错误报告中不输出 API Key 等敏感信息：

```typescript
// 脱敏工具
function sanitizeLog(data: string): string {
  // 移除 API Key 模式
  return data.replace(/sk-[a-zA-Z0-9]{48,}/g, '[API_KEY_REDACTED]');
}
```


## 七、数据读写流程

### 7.1 创建项目流程

```
用户输入项目名称
    ↓
StorageManager.createProject()
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 1. 生成项目 ID：20260819T143022-abc123def                      │
│ 2. 创建项目目录：~/.freecoder/projects/{id}/                   │
│ 3. 创建 meta.json（初始状态）                                  │
│ 4. 创建 requirements.json（空需求）                           │
│ 5. 创建 chat-history.json（空对话）                           │
│ 6. 创建 code/ 目录                                            │
│ 7. 创建 exports/ 目录                                         │
└─────────────────────────────────────────────────────────────────┘
    ↓
返回 Project 对象
```


### 7.2 保存需求卡片流程

```
AI 助理生成需求卡片
    ↓
StorageManager.saveRequirements()
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 1. 读取现有 requirements.json                                  │
│ 2. 合并更新内容                                                │
│ 3. 追加历史记录（变更摘要）                                    │
│ 4. 更新 updatedAt                                              │
│ 5. 原子写入（临时文件 → 重命名）                              │
└─────────────────────────────────────────────────────────────────┘
    ↓
更新完成
```


### 7.3 导出部署包流程

```
用户点击导出
    ↓
StorageManager.createExportPackage()
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 1. 创建临时目录：~/.freecoder/tmp/export-{timestamp}/          │
│ 2. 复制项目代码到临时目录/app/                                 │
│ 3. 生成 Dockerfile 到临时目录                                  │
│ 4. 生成 docker-compose.yml 到临时目录                         │
│ 5. 生成 README.md（部署指引）                                 │
│ 6. 打包为 zip 文件                                             │
│ 7. 移动到 exports/ 目录                                       │
│ 8. 删除临时目录                                                │
│ 9. 更新 meta.json（exportCount++）                            │
└─────────────────────────────────────────────────────────────────┘
    ↓
返回 zip 文件路径
```


## 八、错误处理

### 8.1 常见错误与恢复

| 错误场景 | 恢复策略 |
|---------|---------|
| 磁盘空间不足 | 捕获异常，提示用户清理空间 |
| 文件被占用 | 重试 3 次，失败后提示用户关闭其他程序 |
| 数据文件损坏 | 尝试恢复备份（如有），否则提示用户重建 |
| 权限不足 | 引导用户修改目录权限 |

### 8.2 数据一致性保障

```typescript
// 原子写入工具
export async function atomicWrite(filePath: string, data: any): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak`;
  
  try {
    // 写临时文件
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
    
    // 如果有旧文件，备份
    if (await fs.pathExists(filePath)) {
      await fs.copyFile(filePath, backupPath);
    }
    
    // 原子替换
    await fs.rename(tmpPath, filePath);
    
    // 删除备份
    await fs.remove(backupPath);
  } catch (error) {
    // 恢复备份
    if (await fs.pathExists(backupPath)) {
      await fs.copyFile(backupPath, filePath);
    }
    throw error;
  }
}
```


## 九、生成应用后端运行时存储（SQLite）

> **v2.0 新增章节**：定义 FreeCoder 生成的应用在后端运行时使用的存储方案。

### 9.1 概述

FreeCoder 生成的应用后端（`resources/app-runtime/server.js`）使用 **sql.js（SQLite WASM）** 作为持久化存储，替代早期的 JSON 文件方案，以支持并发安全和更丰富的查询能力。

### 9.2 数据库文件

- **路径**：`{app-runtime}/data/app.db`
- **格式**：SQLite 3 二进制文件
- **WASM 依赖**：`sql.js` 模块，运行时加载 `sql-wasm.wasm`

### 9.3 数据表结构

#### users 表

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  salt TEXT,
  password_hash TEXT,
  github_id TEXT UNIQUE,
  google_id TEXT UNIQUE,
  wechat_openid TEXT UNIQUE,
  avatar_url TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### collection_items 表（通用集合存储）

```sql
CREATE TABLE IF NOT EXISTS collection_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  data TEXT NOT NULL,              -- JSON 字符串
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_collection_user
  ON collection_items(user_id, collection);

CREATE INDEX IF NOT EXISTS idx_collection_updated
  ON collection_items(user_id, collection, updated_at DESC);
```

#### oauth_states 表

```sql
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
```

### 9.4 集合 API（分页 / 搜索 / 排序）

生成应用后端提供通用集合 CRUD API，支持以下查询参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | number | 页码，从 1 开始，默认 1 |
| `pageSize` | number | 每页条数，默认 20，最大 100 |
| `sort` | string | 排序字段，默认 `updated_at` |
| `order` | `'asc' \| 'desc'` | 排序方向，默认 `desc` |
| `search` | string | 模糊搜索关键词（匹配 data JSON 内容） |

**响应格式**：

```json
{
  "items": [...],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3
}
```

### 9.5 OAuth 第三方登录

支持 GitHub / Google / 微信三种 OAuth 登录方式，配置通过 `.env` 文件注入：

| 环境变量 | 说明 |
|---------|------|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App 凭证 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 客户端凭证 |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 微信开放平台网站应用凭证 |
| `OAUTH_REDIRECT_BASE` | OAuth 回调基础 URL，默认 `http://localhost:3000` |
| `JWT_SECRET` | JWT 签名密钥 |
| `JWT_EXPIRES_IN` | JWT 有效期（天），默认 7 |

### 9.6 数据迁移

提供 `migrate-json-to-sqlite.js` 脚本，将早期 JSON 文件存储迁移至 SQLite：

```bash
node migrate-json-to-sqlite.js
```

迁移逻辑：
1. 读取 `data/users.json` → 写入 `users` 表
2. 读取 `data/collections/*.json` → 写入 `collection_items` 表
3. 保留原始 JSON 文件作为备份（`.bak`）

### 9.7 Dockerfile 运行时依赖

导出的部署包 Dockerfile 中包含 `npm install` 步骤，确保 `sql.js` 等运行时依赖被正确安装。


## 十、项目保存位置

> **v2.0 新增章节**：支持用户自定义项目保存位置。

### 10.1 功能说明

用户在创建项目时可选择自定义保存位置（父目录），而非强制使用默认的 `~/.freecoder/projects/` 目录。

### 10.2 ProjectCreateOptions 扩展

```typescript
interface ProjectCreateOptions {
  description?: string;
  template?: ProjectTemplate;
  /** 项目保存位置（父目录，绝对路径）。省略时使用默认位置 */
  location?: string;
}
```

### 10.3 StorageManager 扩展

新增方法：

```typescript
/** 默认项目保存位置（数据目录下的 Project 目录），未选择自定义位置时使用 */
getDefaultProjectsDir(): string;
```

### 10.4 UI 组件

新增 `SaveLocationDialog` 组件，在创建项目时弹出，允许用户：
- 查看当前默认保存位置
- 通过系统文件夹选择器选择自定义位置
- 记住上次选择的位置


## 十一、版本历史

| 版本 | 日期 | 变更说明 |
|------|------|---------|
| v1.0 | 2026-08-19 | 初始版本，定义存储结构 |
| v2.0 | 2026-08-21 | 新增生成应用后端 SQLite 存储方案（第九章）；新增项目保存位置功能（第十章）；Settings 新增 provider/baseUrl/model 字段；API Key 加密降级机制 |


**文档结束**

---

