import { ChatFlow } from '../../src/main/chat/flow';
import { IpcError } from '../../src/main/ipc/helpers';
import type {
  StorageManager,
  ProjectMeta,
  Requirements,
  ChatMessage,
} from '../../src/main/storage/types';

/** 内存版 StorageManager 测试桩（覆盖 ChatFlow 使用的接口） */
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
  async updateProjectMeta(): Promise<void> {}
  async saveRequirements(projectId: string, requirements: Requirements): Promise<void> {
    this.reqs.set(projectId, requirements);
  }
  async getRequirements(projectId: string): Promise<Requirements | null> {
    return this.reqs.get(projectId) ?? null;
  }
  async confirmRequirements(): Promise<void> {}
  async saveChatMessage(projectId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
    const full: ChatMessage = {
      ...message,
      id: `msg-${this.histories.get(projectId)?.length ?? 0 + 1}`,
      timestamp: new Date().toISOString(),
    };
    const list = this.histories.get(projectId) ?? [];
    list.push(full);
    this.histories.set(projectId, list);
    return full;
  }
  async getChatHistory(projectId: string, limit = 50): Promise<ChatMessage[]> {
    return (this.histories.get(projectId) ?? []).slice(-limit);
  }
  async clearChatHistory(projectId: string): Promise<void> {
    this.histories.set(projectId, []);
  }
  async getSettings(): Promise<never> {
    throw new Error('not used in test');
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

describe('AI 助理对话流（ChatFlow）', () => {
  it('IT-IPC-001 发送消息：持久化用户消息，调用 DSH，持久化助理回复', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    const dsh = {
      runTask: jest.fn(async () => ({ reply: '您好！谁会用这个工具呢？', exitCode: 0 })),
    };

    const flow = new ChatFlow({ storage, dsh });
    const outcome = await flow.handleSend(meta.id, '我想做个记账工具');

    expect(outcome.reply).toContain('谁会用');
    expect(dsh.runTask).toHaveBeenCalledTimes(1);
    // 任务文本包含系统提示与用户消息
    const task = dsh.runTask.mock.calls[0][1] as string;
    expect(task).toContain('我想做个记账工具');
    expect(task).toContain('产品需求分析师');

    // 对话历史：用户 + 助理
    const history = await storage.getChatHistory(meta.id);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
  });

  it('IT-IPC-002 DSH 返回需求 JSON：自动保存需求卡片', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    const reply = JSON.stringify({
      project_name: '我的记账本',
      goal: '个人使用的收支记录工具',
      target_users: '个人使用',
      core_features: ['记录收支', '分类统计'],
    });
    const dsh = { runTask: jest.fn(async () => ({ reply, exitCode: 0 })) };

    const flow = new ChatFlow({ storage, dsh });
    await flow.handleSend(meta.id, '个人使用，记录收支');

    const req = await storage.getRequirements(meta.id);
    expect(req).not.toBeNull();
    expect(req?.goal).toBe('个人使用的收支记录工具');
    expect(req?.coreFeatures).toEqual(['记录收支', '分类统计']);
  });

  it('项目不存在：抛出 PROJECT_NOT_FOUND', async () => {
    const storage = new FakeStorage();
    const dsh = { runTask: jest.fn(async () => ({ reply: '', exitCode: 0 })) };
    const flow = new ChatFlow({ storage, dsh });

    await expect(flow.handleSend('proj-missing', '你好')).rejects.toBeInstanceOf(IpcError);
    await expect(flow.handleSend('proj-missing', '你好')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    });
  });
});
