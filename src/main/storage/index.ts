import fs from 'node:fs/promises';
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

/** 项目索引条目：记录每个项目实际所在目录（项目可保存到用户自定义位置） */
interface ProjectIndexEntry {
  name: string;
  dir: string;
}

/** 项目文件夹名：去掉文件系统非法字符、尾部点/空格，限制长度，空名回退 */
function sanitizeProjectFolderName(name: string): string {
  let s = name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[.\s]+$/g, '')
    .trim();
  if (!s) s = '未命名项目';
  if (s.length > 60) s = s.slice(0, 60);
  return s;
}

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
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');
  const rand = crypto.randomBytes(6).toString('hex');
  return `${ts}-${rand}`;
}

/** 消息 ID：msg-{timestamp}-{random}（数据库文档 3.5） */
function generateMessageId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');
  const rand = crypto.randomBytes(4).toString('hex');
  return `msg-${ts}-${rand}`;
}

/**
 * 文件系统存储实现（"文件即数据库"，数据库文档 1.2）。
 * rootDir 可注入，便于测试隔离（测试使用临时目录）。
 */
export class FileStorageManager implements StorageManager {
  /** 项目索引：projectId → { name, dir }，项目可位于任意用户目录（数据库文档 3.3 扩展） */
  private projectIndex: Record<string, ProjectIndexEntry> = {};
  private indexLoaded = false;

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
  private indexPath(): string {
    return path.join(this.rootDir, 'project-index.json');
  }
  /** 历史默认布局（~/.freecoder/projects/），仅用于旧数据回填与兜底 */
  private projectsRoot(): string {
    return path.join(this.rootDir, 'projects');
  }
  /** 默认项目保存位置：本程序数据目录下的 Project 目录 */
  getDefaultProjectsDir(): string {
    return path.join(this.rootDir, 'Project');
  }
  getProjectDir(projectId: string): string {
    return this.projectIndex[projectId]?.dir ?? path.join(this.projectsRoot(), projectId);
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
    await fs.mkdir(this.getDefaultProjectsDir(), { recursive: true });
    await fs.mkdir(path.join(this.rootDir, 'logs'), { recursive: true });
    await fs.mkdir(path.join(this.rootDir, 'tmp'), { recursive: true });
    if (!(await exists(this.settingsPath()))) {
      await atomicWrite(this.settingsPath(), defaultSettings());
    }
    await this.loadProjectIndex();
  }

  // ========== 项目索引 ==========
  /** 从索引文件加载项目索引；首次迁移时回填旧布局（~/.freecoder/projects/） */
  private async loadProjectIndex(): Promise<void> {
    this.projectIndex = await this.readJson<Record<string, ProjectIndexEntry>>(
      this.indexPath(),
      {},
    );
    this.indexLoaded = true;

    let changed = false;
    try {
      const entries = await fs.readdir(this.projectsRoot(), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = await this.readJson<ProjectMeta | null>(
          path.join(this.projectsRoot(), entry.name, 'meta.json'),
          null,
        );
        if (meta && !this.projectIndex[meta.id]) {
          this.projectIndex[meta.id] = {
            name: meta.name,
            dir: path.join(this.projectsRoot(), entry.name),
          };
          changed = true;
        }
      }
    } catch {
      // 旧目录不存在时忽略
    }
    if (changed) await this.persistIndex();
  }

  private async persistIndex(): Promise<void> {
    await atomicWrite(this.indexPath(), this.projectIndex);
  }

  private async ensureIndexLoaded(): Promise<void> {
    if (!this.indexLoaded) await this.loadProjectIndex();
  }

  /** 计算项目文件夹路径：以项目名命名，重名自动追加 -2/-3…（Windows/macOS 忽略大小写） */
  private async resolveProjectDir(parent: string, name: string): Promise<string> {
    const base = sanitizeProjectFolderName(name);
    const occupied = async (dir: string): Promise<boolean> => {
      const norm = dir.toLowerCase();
      const inIndex = Object.values(this.projectIndex).some((e) => e.dir.toLowerCase() === norm);
      if (inIndex) return true;
      try {
        await fs.access(dir);
        return true;
      } catch {
        return false;
      }
    };
    let dir = path.join(parent, base);
    let suffix = 2;
    while (await occupied(dir)) {
      dir = path.join(parent, `${base}-${suffix++}`);
    }
    return dir;
  }

  /**
   * v0.1.02 P1-2：根据实际占用的目录名反推"唯一显示名"，让 meta.name 与目录名严格一致。
   * resolveProjectDir 在重名时会返回 `base-2/-3/…`，因此 meta.name 必须同步追加后缀，
   * 否则渲染层 UI（欢迎页 / ProjectSwitcher）展示的是原始 name，文件系统却是带后缀的目录，
   * 形成 UI 承诺和实际行为的脱节（验收报告 P1-2）。
   */
  private dirToDisplayName(dir: string, originalName: string): string {
    const base = sanitizeProjectFolderName(originalName);
    const last = path.basename(dir);
    if (last === base) return originalName;
    // 后缀形如 "-2" / "-3"，保留原始大小写（base 由 sanitizeFolder 推导，不一定等于原始 name）
    const suffix = last.slice(base.length);
    if (/^-\d+$/.test(suffix)) {
      return `${originalName}${suffix}`;
    }
    // 极端情况（sanitize 后的 base 长度变化）：回退到目录名
    return last;
  }

  // ========== 项目管理 ==========
  async createProject(name: string, options: ProjectCreateOptions = {}): Promise<ProjectMeta> {
    await this.ensureIndexLoaded();
    const id = generateProjectId();
    const now = new Date().toISOString();
    // 保存位置：用户选择的位置（若有），否则使用默认的 Project 目录
    const parent = options.location?.trim()
      ? path.resolve(options.location)
      : this.getDefaultProjectsDir();
    const dir = await this.resolveProjectDir(parent, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(dir, 'code'), { recursive: true });
    await fs.mkdir(path.join(dir, 'exports'), { recursive: true });

    // v0.1.02 P1-2：唯一显示名 = 原始 name（无冲突）或 `${name}-N`（冲突时），
    // 与实际目录名严格同步，避免 UI 提示与文件系统行为不一致。
    const displayName = this.dirToDisplayName(dir, name);

    // 先登记索引再写文件（metaPath 等路径解析依赖索引）
    this.projectIndex[id] = { name: displayName, dir };
    await this.persistIndex();

    const meta: ProjectMeta = {
      id,
      name: displayName,
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
    await this.ensureIndexLoaded();
    const metas: ProjectMeta[] = [];
    for (const entry of Object.values(this.projectIndex)) {
      const meta = await this.readJson<ProjectMeta | null>(path.join(entry.dir, 'meta.json'), null);
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async deleteProject(id: string): Promise<void> {
    await fs.rm(this.getProjectDir(id), { recursive: true, force: true });
    if (this.projectIndex[id]) {
      delete this.projectIndex[id];
      await this.persistIndex();
    }
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
