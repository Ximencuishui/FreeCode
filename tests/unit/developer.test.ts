import { Developer } from '../../src/main/dev/developer';
import type { StorageManager, ProjectMeta, Requirements, ChatMessage } from '../../src/main/storage/types';

/** 内存版 StorageManager 测试桩 */
class FakeStorage implements StorageManager {
  projects = new Map<string, ProjectMeta>();
  reqs = new Map<string, Requirements>();
  histories = new Map<string, ChatMessage[]>();

  async init(): Promise<void> {}
  async createProject(name: string): Promise<ProjectMeta> {
    const meta: ProjectMeta = {
      id: `proj-${this.projects.size + 1}`,
      name,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      codePath: './code',
      exportCount: 0,
      totalChatMessages: 0,
    };
    this.projects.set(meta.id, meta);
    return meta;
  }
  async getProject(id: string): Promise<ProjectMeta | null> {
    return this.projects.get(id) ?? null;
  }
  async listProjects(): Promise<ProjectMeta[]> {
    return [...this.projects.values()];
  }
  async deleteProject(): Promise<void> {}
  async updateProjectMeta(id: string, updates: Partial<ProjectMeta>): Promise<void> {
    const meta = this.projects.get(id);
    if (meta) this.projects.set(id, { ...meta, ...updates });
  }
  async saveRequirements(projectId: string, requirements: Requirements): Promise<void> {
    this.reqs.set(projectId, requirements);
  }
  async getRequirements(projectId: string): Promise<Requirements | null> {
    return this.reqs.get(projectId) ?? null;
  }
  async confirmRequirements(projectId: string): Promise<void> {
    const req = this.reqs.get(projectId);
    if (req) this.reqs.set(projectId, { ...req, confirmed: true });
  }
  async saveChatMessage(): Promise<ChatMessage> {
    throw new Error('not used');
  }
  async getChatHistory(): Promise<ChatMessage[]> {
    return [];
  }
  async clearChatHistory(): Promise<void> {}
  async getSettings(): Promise<never> {
    throw new Error('not used');
  }
  async saveSettings(): Promise<void> {}
  async saveApiKey(): Promise<void> {}
  async loadApiKey(): Promise<string | null> {
    return null;
  }
  getProjectDir(projectId: string): string {
    return `/fake/projects/${projectId}`;
  }
  getProjectCodePath(projectId: string): string {
    return `/fake/projects/${projectId}/code`;
  }
  async ensureProjectDirectories(): Promise<void> {}
}

function makeRequirements(projectId: string): Requirements {
  return {
    projectId,
    version: '1.0',
    confirmed: true,
    goal: '收支记录工具',
    targetUsers: '个人',
    coreFeatures: ['记录收支'],
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

describe('开发执行器（Developer）', () => {
  it('开发成功：状态 developing → ready，任务包含需求', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));

    const dsh = {
      runTask: jest.fn(async () => ({ reply: '已完成开发', exitCode: 0 })),
    };
    const developer = new Developer({ storage, dsh });

    const outcome = await new Promise<{ success: boolean; message: string; durationMs: number }>(
      (resolve) => developer.startDevelopment(meta.id, resolve),
    );

    expect(outcome.success).toBe(true);
    expect(outcome.message).toContain('开发完成');
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);

    // 状态流转与任务内容
    expect((await storage.getProject(meta.id))?.status).toBe('ready');
    const task = dsh.runTask.mock.calls[0][1] as string;
    expect(task).toContain('收支记录工具');
    expect(task).toContain('index.html');
    // workspace 为代码目录
    expect(dsh.runTask.mock.calls[0][0]).toBe(storage.getProjectCodePath(meta.id));
  });

  it('开发失败：状态保持 developing，回调 success=false', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));

    const dsh = {
      runTask: jest.fn(async () => ({ reply: '', exitCode: 1 })),
    };
    const developer = new Developer({ storage, dsh });

    const outcome = await new Promise<{ success: boolean; message: string }>((resolve) =>
      developer.startDevelopment(meta.id, resolve),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.message).toContain('小状况');
    expect((await storage.getProject(meta.id))?.status).toBe('developing');
  });
});
