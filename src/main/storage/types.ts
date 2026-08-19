import type { ProjectStatus, ProjectTemplate } from '../../shared/types/project';
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
  authentication?: 'none' | 'password' | 'wechat' | 'sms';
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
  saveChatMessage(projectId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage>;
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
  ensureProjectDirectories(projectId: string): Promise<void>;
}
