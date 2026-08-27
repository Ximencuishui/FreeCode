import type { ProjectStatus, ProjectTemplate, VersionPlan } from '../../shared/types/project';
import type { SignalType } from '../../shared/types/chat';

/**
 * 本地存储数据文件类型与 StorageManager 接口。
 * 依据《FreeCoder 数据库设计文档（本地存储方案）》v1.0 定义。
 */

// ========== 用户设置（数据库文档 3.1） ==========
export interface StoredSettings {
  version: '1.0';
  projectsPath: string;
  language: 'zh-CN' | 'en-US';
  darkMode: boolean;
  telemetryEnabled: false;
  /** 大模型提供商（默认 DeepSeek 官方） */
  provider: 'deepseek' | 'openai-compatible';
  /** 自定义接口 Base URL（如 https://api.deepseek.com） */
  baseUrl?: string;
  /** 模型名（如 deepseek-chat） */
  model?: string;
  preview: {
    autoOpen: boolean;
    portRange: [number, number];
  };
  export: {
    includeDocker: boolean;
    includeReadme: boolean;
  };
  lastOpenedProject?: string;
  firstLaunch: boolean;
  updatedAt: string;
}

// ========== 项目元数据（数据库文档 3.3） ==========
export interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  template?: ProjectTemplate;
  /** 版本分段计划（需求确认后、写代码前生成；确认计划后据此开发 V1） */
  versionPlan?: VersionPlan | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  codePath: string;
  previewPort?: number;
  exportCount: number;
  totalChatMessages: number;
}

export interface ProjectCreateOptions {
  description?: string;
  template?: ProjectTemplate;
  /** 项目保存位置（父目录，绝对路径）。省略时使用默认位置（数据目录下的 Project 目录） */
  location?: string;
}

// ========== 需求卡片（数据库文档 3.4） ==========
export interface Requirements {
  projectId: string;
  version: '1.0';
  confirmed: boolean;
  confirmedAt?: string;
  goal: string;
  targetUsers: string;
  coreFeatures: string[];
  useScenarios?: string;
  dataRequirements?: string[];
  visualStyle?: string;
  platform?: 'web' | 'mini-program' | 'both';
  /** 主要页面/界面清单（UX：首页、添加记录、统计报表…） */
  pages?: string[];
  /** 布局偏好（如：顶部导航+内容区；左侧菜单+右侧详情；单页卡片流） */
  layout?: string;
  /** 界面感觉（用户口语描述：简洁/活泼/专业…可含色彩偏好） */
  styleFeeling?: string;
  /** 主要使用设备 */
  device?: 'desktop' | 'mobile' | 'both';
  /** 关键操作流程（如：添加后立即刷新并提示成功） */
  keyFlows?: string[];
  /** 是否需要登录/账号体系（非技术用户易忽略的边界维度） */
  authentication?: 'none' | 'password' | 'wechat' | 'sms';
  /** 使用规模（单人 / 小团队 / 公开多人） */
  usageScale?: 'solo' | 'team' | 'public';
  /** 导出与分享需求（如：导出报告、备份数据、分享链接） */
  exportFeatures?: string[];
  /** 界面语言（zh-CN / en-US / both） */
  uiLanguage?: 'zh-CN' | 'en-US' | 'both';
  history: {
    version: number;
    timestamp: string;
    changes: string;
  }[];
  updatedAt: string;
}

// ========== 对话历史（数据库文档 3.5） ==========
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'signal';
  content: string;
  /** 模型推理过程（思考过程；assistant 消息可含，随消息持久化） */
  reasoning?: string;
  signal?: {
    type: SignalType;
    suggestions?: string[];
    original?: string;
  };
  metadata?: {
    elementInfo?: unknown;
    exportInfo?: unknown;
  };
  timestamp: string;
  isComplete: boolean;
}

export interface ChatHistory {
  projectId: string;
  messages: ChatMessage[];
  updatedAt: string;
}

// ========== 导出（数据库文档 3.6） ==========
export interface ExportOptions {
  includeDocker?: boolean;
  includeReadme?: boolean;
  /** 上线配置（缺省时使用默认配置，全部本地零依赖） */
  config?: import('../../shared/types/export').DeployConfig;
}

// ========== StorageManager 接口（数据库文档 4.1） ==========
export interface StorageManager {
  // 初始化
  init(): Promise<void>;
  // 项目管理
  createProject(name: string, options?: ProjectCreateOptions): Promise<ProjectMeta>;
  getProject(id: string): Promise<ProjectMeta | null>;
  listProjects(): Promise<ProjectMeta[]>;
  deleteProject(id: string): Promise<void>;
  updateProjectMeta(id: string, updates: Partial<ProjectMeta>): Promise<void>;
  // 需求管理
  saveRequirements(projectId: string, requirements: Requirements): Promise<void>;
  getRequirements(projectId: string): Promise<Requirements | null>;
  confirmRequirements(projectId: string): Promise<void>;
  // 对话管理
  saveChatMessage(
    projectId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'>,
  ): Promise<ChatMessage>;
  getChatHistory(projectId: string, limit?: number): Promise<ChatMessage[]>;
  clearChatHistory(projectId: string): Promise<void>;
  // 设置管理
  getSettings(): Promise<StoredSettings>;
  saveSettings(settings: Partial<StoredSettings>): Promise<void>;
  // API Key 管理
  saveApiKey(key: string): Promise<void>;
  loadApiKey(): Promise<string | null>;
  // 路径辅助
  getProjectDir(projectId: string): string;
  getProjectCodePath(projectId: string): string;
  /** 默认项目保存位置（数据目录下的 Project 目录），未选择自定义位置时使用 */
  getDefaultProjectsDir(): string;
  ensureProjectDirectories(projectId: string): Promise<void>;
}
