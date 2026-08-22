import { VersionPlanner } from '../../src/main/dev/planner';
import type { StorageManager, ProjectMeta, Requirements, ChatMessage } from '../../src/main/storage/types';

/** 内存版 StorageManager 测试桩 */
class FakeStorage implements StorageManager {
  projects = new Map<string, ProjectMeta>();
  reqs = new Map<string, Requirements>();

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
  async confirmRequirements(): Promise<void> {}
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
    coreFeatures: ['记录收支', '分类统计'],
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

describe('版本分段规划器（VersionPlanner）', () => {
  it('AI 返回有效计划：状态 planned，保存解析后的计划', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));

    const reply = JSON.stringify({
      versions: [
        { label: 'V1', description: '先能记账', features: ['记录收支'] },
        { label: 'V2', description: '看得更明白', features: ['分类统计'] },
      ],
    });
    const dsh = { runTask: jest.fn(async () => ({ reply, exitCode: 0 })) };
    const planner = new VersionPlanner({ storage, dsh });

    const outcome = await new Promise<{ success: boolean; message: string }>((resolve) =>
      planner.generatePlan(meta.id, resolve),
    );

    expect(outcome.success).toBe(true);
    expect((await storage.getProject(meta.id))?.status).toBe('planned');
    const plan = (await storage.getProject(meta.id))?.versionPlan;
    expect(plan?.versions[0].features).toEqual(['记录收支']);
    expect(plan?.versions[1].features).toEqual(['分类统计']);
  });

  it('AI 返回无效内容：使用兜底计划（V1=首个功能）', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));

    const dsh = { runTask: jest.fn(async () => ({ reply: '抱歉，我无法处理', exitCode: 0 })) };
    const planner = new VersionPlanner({ storage, dsh });

    const outcome = await new Promise<{ success: boolean }>((resolve) =>
      planner.generatePlan(meta.id, resolve),
    );

    expect(outcome.success).toBe(true);
    const plan = (await storage.getProject(meta.id))?.versionPlan;
    expect(plan?.versions[0].features).toEqual(['记录收支']);
    expect(plan?.versions[1].features).toEqual(['分类统计']);
  });

  it('DSH 执行失败（exit 1）：使用兜底计划，流程不中断', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));

    const dsh = { runTask: jest.fn(async () => ({ reply: '', exitCode: 1 })) };
    const planner = new VersionPlanner({ storage, dsh });

    const outcome = await new Promise<{ success: boolean }>((resolve) =>
      planner.generatePlan(meta.id, resolve),
    );

    expect(outcome.success).toBe(true);
    expect((await storage.getProject(meta.id))?.versionPlan).not.toBeNull();
  });

  it('需求缺失：回调 success=false', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    // 不保存需求

    const dsh = { runTask: jest.fn(async () => ({ reply: '', exitCode: 0 })) };
    const planner = new VersionPlanner({ storage, dsh });

    const outcome = await new Promise<{ success: boolean }>((resolve) =>
      planner.generatePlan(meta.id, resolve),
    );

    expect(outcome.success).toBe(false);
    expect(dsh.runTask).not.toHaveBeenCalled();
  });

  it('存储写入异常：onDone 仍被回调一次且 success=false（不悬挂）', async () => {
    class BrokenStorage extends FakeStorage {
      override async updateProjectMeta(): Promise<void> {
        throw new Error('磁盘写入失败');
      }
    }
    const storage = new BrokenStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));

    const dsh = { runTask: jest.fn(async () => ({ reply: '', exitCode: 0 })) };
    const planner = new VersionPlanner({ storage, dsh });

    const onDone = jest.fn();
    await planner.generatePlan(meta.id, onDone);

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0].success).toBe(false);
  });
});
