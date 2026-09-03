import { Developer } from '../../src/main/dev/developer';
import * as runtimeModule from '../../src/main/dev/runtime';
import { DSHError } from '../../src/main/dsh/errors';
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
  getDefaultProjectsDir(): string {
    return '/fake/projects';
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

  it('有版本计划：开发任务只包含 V1 功能子集', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, {
      ...makeRequirements(meta.id),
      coreFeatures: ['记录收支', '分类统计'],
    });
    // 版本计划：V1 只做「记录收支」
    await storage.updateProjectMeta(meta.id, {
      versionPlan: {
        versions: [
          { label: 'V1', description: '先能记账', features: ['记录收支'] },
          { label: 'V2', description: '看得更明白', features: ['分类统计'] },
        ],
      },
    });

    const dsh = {
      runTask: jest.fn(async () => ({ reply: '已完成开发', exitCode: 0 })),
    };
    const developer = new Developer({ storage, dsh });

    await new Promise<void>((resolve) => developer.startDevelopment(meta.id, () => resolve()));

    const task = dsh.runTask.mock.calls[0][1] as string;
    expect(task).toContain('记录收支');
    expect(task).toContain('只开发 V1');
    expect(task).not.toContain('分类统计');
  });

  it('本地模式（authentication=none）：不调用 injectAuthRuntime，开发任务用 localStorage', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('本地记账本');
    await storage.saveRequirements(meta.id, {
      ...makeRequirements(meta.id),
      authentication: 'none',
    });

    // spy 注入函数；本地模式不应被调用
    const spy = jest.spyOn(runtimeModule, 'injectAuthRuntime').mockResolvedValue();

    const dsh = {
      runTask: jest.fn(async () => ({ reply: '已完成开发', exitCode: 0 })),
    };
    const developer = new Developer({ storage, dsh });

    const outcome = await new Promise<{ success: boolean; message: string }>((resolve) =>
      developer.startDevelopment(meta.id, resolve),
    );

    expect(outcome.success).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    // 本地模式：开发任务包含 localStorage + 不出现登录模式专属的 SDK 调用
    const localTask = dsh.runTask.mock.calls[0][1] as string;
    expect(localTask).toContain('localStorage');
    expect(localTask).not.toContain('FreeCoderAuth.init');
    expect(localTask).not.toContain('FreeCoderAuth.requireLogin');
    expect(localTask).not.toContain('FreeCoderAuth.data');
    expect(localTask).not.toContain('请按以下方式集成');

    spy.mockRestore();
  });

  it('登录模式（authentication=password）：调用 injectAuthRuntime 一次', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('账号密码应用');
    await storage.saveRequirements(meta.id, {
      ...makeRequirements(meta.id),
      authentication: 'password',
    });

    const spy = jest.spyOn(runtimeModule, 'injectAuthRuntime').mockResolvedValue();

    const dsh = {
      runTask: jest.fn(async () => ({ reply: '已完成开发', exitCode: 0 })),
    };
    const developer = new Developer({ storage, dsh });

    await new Promise<void>((resolve) =>
      developer.startDevelopment(meta.id, () => resolve()),
    );

    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  /**
   * v3.2.2 P0-5：后台任务取消（Developer.cancel）+ P0-5-1：TASK_CANCELLED 识别为静默成功。
   */
  describe('取消（P0-5 + P0-5-1）', () => {
    it('cancel 未注册的项目返回 false（幂等）', () => {
      const developer = new Developer({ storage: new FakeStorage(), dsh: { runTask: jest.fn() } });
      expect(developer.cancel('never-started')).toBe(false);
      expect(developer.cancel('never-started')).toBe(false); // 二次幂等
    });

    it('cancel 已注册项目调用 controller.abort（通过 DSH 抛 TASK_CANCELLED 模拟）', async () => {
      const storage = new FakeStorage();
      const meta = await storage.createProject('测试');
      await storage.saveRequirements(meta.id, makeRequirements(meta.id));

      // DSH runTask 抛 TASK_CANCELLED，模拟已注册 controller 被 abort 的下游效果
      const dsh = {
        runTask: jest.fn(async () => {
          throw new DSHError('TASK_CANCELLED', '任务已被中断');
        }),
      };
      const developer = new Developer({ storage, dsh });

      const outcome = await new Promise<{ success: boolean; cancelled?: boolean; message: string }>(
        (resolve) => developer.startDevelopment(meta.id, resolve as never),
      );

      // P0-5-1：cancelled=true 让 IPC 层不广播给用户
      expect(outcome.cancelled).toBe(true);
      expect(outcome.success).toBe(false); // 不算成功
      expect(outcome.message).toBe('任务已取消');
    });

    it('cancel 期间 controller 信号被 abort → DSH 接到 aborted signal', async () => {
      const storage = new FakeStorage();
      const meta = await storage.createProject('测试');
      await storage.saveRequirements(meta.id, makeRequirements(meta.id));

      let capturedSignal: AbortSignal | undefined;
      // DSH runTask 检查 signal.aborted 后抛 TASK_CANCELLED
      const dsh = {
        runTask: jest.fn(async (_dir, _task, _onProgress, signal?: AbortSignal) => {
          capturedSignal = signal;
          // 等待 cancel 后 signal 变 aborted
          await new Promise<void>((resolve) => {
            const t = setInterval(() => {
              if (signal?.aborted) {
                clearInterval(t);
                resolve();
              }
            }, 5);
          });
          throw new DSHError('TASK_CANCELLED', '任务已被中断');
        }),
      };
      const developer = new Developer({ storage, dsh });

      // 异步启动开发任务
      void new Promise<void>((resolve) =>
        developer.startDevelopment(meta.id, () => resolve()),
      );

      // 等注册到 Map 后取消
      await new Promise<void>((r) => setTimeout(r, 20));
      expect(developer.isActive(meta.id)).toBe(true);
      const cancelled = developer.cancel(meta.id);
      expect(cancelled).toBe(true);

      // 等 finish 清理 Map
      await new Promise<void>((r) => setTimeout(r, 100));
      expect(developer.isActive(meta.id)).toBe(false);
      expect(capturedSignal?.aborted).toBe(true);
    });

    it('cancel 后被新启动任务占位 → 旧 cancel 不误杀新任务', async () => {
      const storage = new FakeStorage();
      const meta = await storage.createProject('测试');
      await storage.saveRequirements(meta.id, makeRequirements(meta.id));

      // 第一轮 DSH：捕获 signal → 等 cancel → 抛 TASK_CANCELLED
      const firstAbort: { signal?: AbortSignal } = {};
      const dsh1 = {
        runTask: jest.fn(async (_d, _t, _p, signal?: AbortSignal) => {
          firstAbort.signal = signal;
          await new Promise<void>((r) => setTimeout(r, 100));
          if (signal?.aborted) throw new DSHError('TASK_CANCELLED', '已中断');
          return { reply: 'done', exitCode: 0 };
        }),
      };
      const developer = new Developer({ storage, dsh: dsh1 });

      void new Promise<void>((r) => developer.startDevelopment(meta.id, () => r()));
      await new Promise<void>((r) => setTimeout(r, 20));
      developer.cancel(meta.id);
      // 等第一轮 finish 清理 Map
      await new Promise<void>((r) => setTimeout(r, 150));

      // 第二轮：DSH runTask 立即成功
      const dsh2 = { runTask: jest.fn(async () => ({ reply: 'done2', exitCode: 0 })) };
      const developer2 = new Developer({ storage, dsh: dsh2 });
      const outcome = await new Promise<{ success: boolean; cancelled?: boolean }>((resolve) =>
        developer2.startDevelopment(meta.id, resolve as never),
      );
      expect(outcome.success).toBe(true);
      expect(outcome.cancelled).toBeUndefined();
    });
  });
});
