import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { plainEncryptor, type StringEncryptor } from '../security/encryption';
import { defaultSettings, migrateSettings } from './migration';
import type {
  StorageManager,
  StoredSettings,
  ProjectMeta,
  ProjectCreateOptions,
  Requirements,
  ChatMessage,
  ChatHistory,
} from './types';

/** FreeCoder 数据根目录（FREECODER_HOME 可覆盖，用于便携/测试隔离） */
export function getFreeCoderDir(): string {
  return process.env.FREECODER_HOME ?? path.join(os.homedir(), '.freecoder');
}

/** 单文件最大消息数，超过自动归档（数据库文档 4.2.2） */
const MAX_MESSAGES_PER_FILE = 1000;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 原子写入：临时文件 → 备份 → 重命名替换，失败自动恢复备份（数据库文档 8.2） */
export async function atomicWrite(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak`;
  const json = JSON.stringify(data, null, 2);

  try {
    await fs.writeFile(tmpPath, json, 'utf-8');
    if (await exists(filePath)) {
      await fs.copyFile(filePath, backupPath);
    }
    await fs.rename(tmpPath, filePath);
    await fs.rm(backupPath, { force: true });
  } catch (error) {
    if (await exists(backupPath)) {
      await fs.copyFile(backupPath, filePath);
    }
    await fs.rm(tmpPath, { force: true });
    throw error;
  }
}

/** 项目 ID：{timestamp}-{随机串}（数据库文档 2.2） */
function generateProjectId(): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  const rand = crypto.randomBytes(6).toString('hex');
  return `${ts}-${rand}`;
}

/** 消息 ID：msg-{timestamp}-{random}（数据库文档 3.5） */
function generateMessageId(): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  const rand = crypto.randomBytes(4).toString('hex');
  return `msg-${ts}-${rand}`;
}

/**
 * 文件系统存储实现（"文件即数据库"，数据库文档 1.2）。
 * rootDir 可注入，便于测试隔离（测试使用临时目录）。
 */
export class FileStorageManager implements StorageManager {
  constructor(
    private readonly rootDir: string,
    private readonly encryptor: StringEncryptor = plainEncryptor,
    private readonly maxMessagesPerFile: number = MAX_MESSAGES_PER_FILE,
  ) {}

  // ========== 路径 ==========
  private settingsPath(): string {
    return path.join(this.rootDir, 'settings.json');
  }
  private apiKeyPath(): string {
    return path.join(this.rootDir, 'api-key.encrypted');
  }
  private projectsRoot(): string {
    return path.join(this.rootDir, 'projects');
  }
  getProjectDir(projectId: string): string {
    return path.join(this.projectsRoot(), projectId);
  }
  getProjectCodePath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'code');
  }
  private metaPath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'meta.json');
  }
  private requirementsPath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'requirements.json');
  }
  private chatHistoryPath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'chat-history.json');
  }
  private chatArchivePath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'chat-history.archive.json');
  }

  // ========== 工具 ==========
  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return fallback;
    }
  }

  // ========== 初始化 ==========
  async init(): Promise<void> {
    await fs.mkdir(this.projectsRoot(), { recursive: true });
    await fs.mkdir(path.join(this.rootDir, 'logs'), { recursive: true });
    await fs.mkdir(path.join(this.rootDir, 'tmp'), { recursive: true });
    if (!(await exists(this.settingsPath()))) {
      await atomicWrite(this.settingsPath(), defaultSettings());
    }
  }

  // ========== 项目管理 ==========
  async createProject(name: string, options: ProjectCreateOptions = {}): Promise<ProjectMeta> {
    const id = generateProjectId();
    const now = new Date().toISOString();
    const dir = this.getProjectDir(id);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(this.getProjectCodePath(id), { recursive: true });
    await fs.mkdir(path.join(dir, 'exports'), { recursive: true });

    const meta: ProjectMeta = {
      id,
      name,
      description: options.description,
      status: 'draft',
      template: options.template,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      codePath: './code',
      exportCount: 0,
      totalChatMessages: 0,
    };

    const emptyRequirements: Requirements = {
      projectId: id,
      version: '1.0',
      confirmed: false,
      goal: '',
      targetUsers: '',
      coreFeatures: [],
      history: [{ version: 1, timestamp: now, changes: '初始创建' }],
      updatedAt: now,
    };
    const emptyHistory: ChatHistory = { projectId: id, messages: [], updatedAt: now };

    await atomicWrite(this.metaPath(id), meta);
    await atomicWrite(this.requirementsPath(id), emptyRequirements);
    await atomicWrite(this.chatHistoryPath(id), emptyHistory);
    return meta;
  }

  async getProject(id: string): Promise<ProjectMeta | null> {
    return this.readJson<ProjectMeta | null>(this.metaPath(id), null);
  }

  async listProjects(): Promise<ProjectMeta[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.projectsRoot(), { withFileTypes: true });
    } catch {
      return [];
    }
    const metas: ProjectMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await this.readJson<ProjectMeta | null>(
        this.metaPath(entry.name),
        null,
      );
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async deleteProject(id: string): Promise<void> {
    await fs.rm(this.getProjectDir(id), { recursive: true, force: true });
  }

  async updateProjectMeta(id: string, updates: Partial<ProjectMeta>): Promise<void> {
    const meta = await this.getProject(id);
    if (!meta) return;
    await atomicWrite(this.metaPath(id), {
      ...meta,
      ...updates,
      id,
      updatedAt: new Date().toISOString(),
    });
  }

  async ensureProjectDirectories(projectId: string): Promise<void> {
    const dir = this.getProjectDir(projectId);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(this.getProjectCodePath(projectId), { recursive: true });
    await fs.mkdir(path.join(dir, 'exports'), { recursive: true });
  }

  // ========== 需求管理 ==========
  async saveRequirements(projectId: string, requirements: Requirements): Promise<void> {
    await this.ensureProjectDirectories(projectId);
    await atomicWrite(this.requirementsPath(projectId), {
      ...requirements,
      projectId,
      updatedAt: new Date().toISOString(),
    });
  }

  async getRequirements(projectId: string): Promise<Requirements | null> {
    return this.readJson<Requirements | null>(this.requirementsPath(projectId), null);
  }

  async confirmRequirements(projectId: string): Promise<void> {
    const req = await this.getRequirements(projectId);
    if (!req) return;
    const now = new Date().toISOString();
    await this.saveRequirements(projectId, {
      ...req,
      confirmed: true,
      confirmedAt: now,
      history: [
        ...req.history,
        { version: req.history.length + 1, timestamp: now, changes: '确认需求' },
      ],
    });
  }

  // ========== 对话管理 ==========
  async saveChatMessage(
    projectId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'>,
  ): Promise<ChatMessage> {
    const full: ChatMessage = {
      ...message,
      id: generateMessageId(),
      timestamp: new Date().toISOString(),
    };
    await this.appendChatMessage(projectId, full);
    return full;
  }

  async appendChatMessage(projectId: string, message: ChatMessage): Promise<void> {
    await this.ensureProjectDirectories(projectId);
    const history = await this.readJson<ChatHistory>(this.chatHistoryPath(projectId), {
      projectId,
      messages: [],
      updatedAt: '',
    });
    history.messages.push(message);
    history.updatedAt = new Date().toISOString();
    await atomicWrite(this.chatHistoryPath(projectId), history);

    const meta = await this.getProject(projectId);
    if (meta) {
      await this.updateProjectMeta(projectId, {
        totalChatMessages: meta.totalChatMessages + 1,
        lastOpenedAt: new Date().toISOString(),
      });
    }
  }

  async getChatHistory(projectId: string, limit = 50): Promise<ChatMessage[]> {
    const history = await this.readJson<ChatHistory>(this.chatHistoryPath(projectId), {
      projectId,
      messages: [],
      updatedAt: '',
    });

    // 超过上限自动归档（数据库文档 4.2.2）
    if (history.messages.length > this.maxMessagesPerFile) {
      await this.archiveOldMessages(projectId, history);
      return this.getChatHistory(projectId, limit);
    }
    return history.messages.slice(-limit);
  }

  private async archiveOldMessages(projectId: string, history: ChatHistory): Promise<void> {
    const overflow = history.messages.length - this.maxMessagesPerFile;
    const old = history.messages.slice(0, overflow);
    const archive = await this.readJson<ChatHistory>(this.chatArchivePath(projectId), {
      projectId,
      messages: [],
      updatedAt: '',
    });
    archive.messages.push(...old);
    archive.updatedAt = new Date().toISOString();
    await atomicWrite(this.chatArchivePath(projectId), archive);

    history.messages = history.messages.slice(overflow);
    history.updatedAt = new Date().toISOString();
    await atomicWrite(this.chatHistoryPath(projectId), history);
  }

  async clearChatHistory(projectId: string): Promise<void> {
    await this.ensureProjectDirectories(projectId);
    await atomicWrite(this.chatHistoryPath(projectId), {
      projectId,
      messages: [],
      updatedAt: new Date().toISOString(),
    });
  }

  // ========== 设置管理 ==========
  async getSettings(): Promise<StoredSettings> {
    const raw = await this.readJson<unknown>(this.settingsPath(), null);
    return migrateSettings(raw);
  }

  async saveSettings(settings: Partial<StoredSettings>): Promise<void> {
    const current = await this.getSettings();
    await atomicWrite(this.settingsPath(), {
      ...current,
      ...settings,
      updatedAt: new Date().toISOString(),
    });
  }

  // ========== API Key 管理 ==========
  async saveApiKey(key: string): Promise<void> {
    const encrypted = this.encryptor.encrypt(key);
    // 原子写 + POSIX 收紧权限（0600），避免写一半损坏或同用户可读
    const file = this.apiKeyPath();
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, encrypted, 'utf-8');
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600).catch(() => undefined);
  }

  async loadApiKey(): Promise<string | null> {
    try {
      const content = await fs.readFile(this.apiKeyPath(), 'utf-8');
      return this.encryptor.decrypt(content);
    } catch {
      return null;
    }
  }
}
