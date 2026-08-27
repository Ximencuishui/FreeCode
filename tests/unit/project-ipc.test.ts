/** @jest-environment node */
/**
 * 项目管理域 IPC 守卫单元测试（版本分段相关）：
 * - project:confirm 幂等：已进入 planned/后续阶段时不再重复生成版本计划
 * - project:confirm-plan 结构校验：V1 缺失标签或功能时拒绝，避免静默回退为全量开发
 */
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  BrowserWindow: { getAllWindows: jest.fn(() => []) },
  dialog: { showOpenDialog: jest.fn() },
}));

import { ipcMain } from 'electron';
import { IpcChannels } from '../../src/shared/types/ipc';
import type { StorageManager, ProjectMeta, Requirements } from '../../src/main/storage/types';
import type { VersionPlan } from '../../src/shared/types/project';
import { registerProjectIpc } from '../../src/main/ipc/project';

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
  async saveChatMessage(): Promise<never> {
    throw new Error('not used');
  }
  async getChatHistory(): Promise<never[]> {
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
    confirmed: false,
    goal: '收支记录工具',
    targetUsers: '个人',
    coreFeatures: ['记录收支', '分类统计'],
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

/** 取注册到 ipcMain 的（已包装错误转换的）处理器 */
function getHandler(channel: string): (event: unknown, params: unknown) => Promise<unknown> {
  const call = (ipcMain.handle as jest.Mock).mock.calls.find((c) => c[0] === channel);
  expect(call).toBeDefined();
  return call![1] as (event: unknown, params: unknown) => Promise<unknown>;
}

describe('项目管理域 IPC 守卫（版本分段）', () => {
  const developer = { startDevelopment: jest.fn() };
  const planner = { generatePlan: jest.fn(async () => undefined) };
  const dsh = { runTask: jest.fn(async () => ({ reply: 'REVIEW_PASS', exitCode: 0 })) };

  beforeEach(() => {
    jest.clearAllMocks();
    registerProjectIpc(new FakeStorage(), dsh as never, developer as never, planner as never);
  });

  it('project:confirm 幂等：planned 状态重复确认不再生成计划', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));
    await storage.updateProjectMeta(meta.id, { status: 'planned' });
    // 重新注册，使用带预置数据的 storage
    jest.clearAllMocks();
    registerProjectIpc(storage, dsh as never, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConfirm);
    const result = await handler({}, { projectId: meta.id });

    expect(result).toEqual({ success: true });
    expect(planner.generatePlan).not.toHaveBeenCalled();
    expect((await storage.getProject(meta.id))?.status).toBe('planned');
  });

  it('project:confirm 幂等：developing 状态重复确认不把状态打回 planned', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));
    await storage.updateProjectMeta(meta.id, { status: 'developing' });
    jest.clearAllMocks();
    registerProjectIpc(storage, dsh as never, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConfirm);
    await handler({}, { projectId: meta.id });

    expect(planner.generatePlan).not.toHaveBeenCalled();
    expect((await storage.getProject(meta.id))?.status).toBe('developing');
  });

  it('project:confirm-plan 校验：V1 无功能时拒绝并保持原状态', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));
    const badPlan: VersionPlan = {
      versions: [{ label: 'V1', description: '先能记账', features: [] }],
    };
    jest.clearAllMocks();
    registerProjectIpc(storage, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConfirmPlan);
    const result = await handler({}, { projectId: meta.id, plan: badPlan });

    expect(result).toMatchObject({ success: false, error: { code: 'INVALID_PARAMS' } });
    expect(developer.startDevelopment).not.toHaveBeenCalled();
    expect((await storage.getProject(meta.id))?.status).toBe('draft');
    expect((await storage.getProject(meta.id))?.versionPlan).toBeUndefined();
  });

  it('project:confirm-plan 校验：V1 缺版本标签时拒绝', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));
    const badPlan: VersionPlan = {
      versions: [{ label: '  ', description: '', features: ['记录收支'] }],
    };
    jest.clearAllMocks();
    registerProjectIpc(storage, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConfirmPlan);
    const result = await handler({}, { projectId: meta.id, plan: badPlan });

    expect(result).toMatchObject({ success: false, error: { code: 'INVALID_PARAMS' } });
    expect(developer.startDevelopment).not.toHaveBeenCalled();
  });

  it('project:confirm-plan 合法计划：进入 developing 并启动开发', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id));
    const goodPlan: VersionPlan = {
      versions: [
        { label: 'V1', description: '先能记账', features: ['记录收支'] },
        { label: 'V2', description: '看得更明白', features: ['分类统计'] },
      ],
    };
    developer.startDevelopment.mockImplementation(async () => undefined);
    jest.clearAllMocks();
    registerProjectIpc(storage, dsh as never, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConfirmPlan);
    const result = await handler({}, { projectId: meta.id, plan: goodPlan });

    expect(result).toEqual({ success: true });
    expect(developer.startDevelopment).toHaveBeenCalledTimes(1);
    const metaAfter = await storage.getProject(meta.id);
    expect(metaAfter?.status).toBe('developing');
    expect(metaAfter?.versionPlan).toEqual(goodPlan);
  });
});
