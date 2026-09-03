/** @jest-environment node */
/**
 * v0.1.02 P0-2：转本地模式 IPC 单测。
 *
 * 目的（验收报告 P0-2：本地模式转换后开发任务状态机断裂）：
 * 验证 convertToLocalMode 落地后必须做到的三件事，避免 Developer 按旧版 plan（含「账号/登录页」）
 * 写出仍含登录页的应用：
 *   1) 需求的 authentication 改为 none（记录 history）
 *   2) 项目 meta.versionPlan 清空（关键：清掉旧 plan）
 *   3) 项目状态被打回 'planned'
 *   4) 主动调用 planner.generatePlan(projectId, …) 异步重生基于本地模式的版本计划
 *   5) 不直接调 developer.startDevelopment —— 让用户在对话页主动点确认
 */
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  BrowserWindow: { getAllWindows: jest.fn(() => []) },
  dialog: { showOpenDialog: jest.fn() },
}));

import { ipcMain } from 'electron';
import { IpcChannels } from '../../src/shared/types/ipc';
import type {
  StorageManager,
  ProjectMeta,
  Requirements,
} from '../../src/main/storage/types';
import type { VersionPlan } from '../../src/shared/types/project';
import { registerProjectIpc } from '../../src/main/ipc/project';

/** 内存版 StorageManager 测试桩（与 project-ipc.test.ts 保持同一形状） */
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
  getDefaultProjectsDir(): string {
    return '/fake/projects';
  }
  async ensureProjectDirectories(): Promise<void> {}
}

function makeRequirements(
  projectId: string,
  authentication: Requirements['authentication'],
): Requirements {
  return {
    projectId,
    version: '1.0',
    confirmed: true,
    goal: '收支记录工具',
    targetUsers: '个人',
    coreFeatures: ['记录收支', '分类统计'],
    authentication,
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

const OLD_PLAN: VersionPlan = {
  versions: [
    { label: 'V1', description: '账号系统', features: ['注册', '登录'] },
    { label: 'V2', description: '记账', features: ['记录收支'] },
  ],
};

describe('project:convert-to-local-mode（v0.1.02 P0-2）', () => {
  let developer: { startDevelopment: jest.Mock };
  let planner: { generatePlan: jest.Mock };
  let dsh: { runTask: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    developer = { startDevelopment: jest.fn() };
    planner = { generatePlan: jest.fn(async () => undefined) };
    dsh = { runTask: jest.fn() };
  });

  it('UT-CONV-001 成功转换：authentication=none、versionPlan=null、status=planned、planner.generatePlan 被触发', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id, 'password'));
    // 模拟旧 plan 已存在的状态（典型：用户之前已经在 planned 阶段走过一次）
    await storage.updateProjectMeta(meta.id, { status: 'planned', versionPlan: OLD_PLAN });
    jest.clearAllMocks();
    registerProjectIpc(storage, dsh as never, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConvertToLocalMode);
    const result = await handler({}, { projectId: meta.id });

    expect(result).toMatchObject({ success: true });

    // 1) authentication 已改为 none
    const req = await storage.getRequirements(meta.id);
    expect(req?.authentication).toBe('none');

    // 2) versionPlan 已清空
    const after = await storage.getProject(meta.id);
    expect(after?.versionPlan).toBeNull();

    // 3) 状态打回 planned
    expect(after?.status).toBe('planned');

    // 4) planner.generatePlan 被触发（重生基于本地模式的版本计划）
    expect(planner.generatePlan).toHaveBeenCalledTimes(1);
    expect(planner.generatePlan.mock.calls[0][0]).toBe(meta.id);
    expect(typeof planner.generatePlan.mock.calls[0][1]).toBe('function');

    // 5) 不能直接启动 Developer（让用户在对话页主动点「确认 V1 计划，开始开发」）
    expect(developer.startDevelopment).not.toHaveBeenCalled();
  });

  it('UT-CONV-002 已是本地模式（authentication=none）拒绝转换，不清空 plan、不触发 planner', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('本地项目');
    await storage.saveRequirements(meta.id, makeRequirements(meta.id, 'none'));
    await storage.updateProjectMeta(meta.id, { status: 'developing', versionPlan: OLD_PLAN });
    jest.clearAllMocks();
    registerProjectIpc(storage, dsh as never, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConvertToLocalMode);
    const result = (await handler({}, { projectId: meta.id })) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain('本地模式');

    // 拒绝时不能破坏 plan 与 status，也不能触发重生
    const after = await storage.getProject(meta.id);
    expect(after?.versionPlan).toEqual(OLD_PLAN);
    expect(after?.status).toBe('developing');
    expect(planner.generatePlan).not.toHaveBeenCalled();
    expect(developer.startDevelopment).not.toHaveBeenCalled();
  });

  it('UT-CONV-003 项目不存在时抛 NOT_FOUND，planner 与 developer 均不被触发', async () => {
    const storage = new FakeStorage();
    jest.clearAllMocks();
    registerProjectIpc(storage, dsh as never, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConvertToLocalMode);
    const result = (await handler({}, { projectId: 'no-such' })) as {
      success: boolean;
      error?: { code?: string; message?: string };
    };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PROJECT_NOT_FOUND');
    expect(planner.generatePlan).not.toHaveBeenCalled();
    expect(developer.startDevelopment).not.toHaveBeenCalled();
  });

  it('UT-CONV-004 需求尚未生成时拒绝转换（参数错误），planner 不被触发', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('空需求项目');
    // 不写 requirements：getRequirements 返回 null
    jest.clearAllMocks();
    registerProjectIpc(storage, dsh as never, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConvertToLocalMode);
    const result = (await handler({}, { projectId: meta.id })) as {
      success: boolean;
      error?: { code?: string; message?: string };
    };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
    expect(planner.generatePlan).not.toHaveBeenCalled();
    expect(developer.startDevelopment).not.toHaveBeenCalled();
  });

  it('UT-CONV-005 历史追加：转换后 requirements.history 末尾新增「切换为本地模式」记录', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    const initial = makeRequirements(meta.id, 'password');
    await storage.saveRequirements(meta.id, initial);
    jest.clearAllMocks();
    registerProjectIpc(storage, dsh as never, developer as never, planner as never);

    const handler = getHandler(IpcChannels.projectConvertToLocalMode);
    await handler({}, { projectId: meta.id });

    const req = await storage.getRequirements(meta.id);
    // 历史至少新增 1 条（之前的 history 可能为空，至少 +1 条；这里的 initial.history 是空，所以是 1 条）
    expect(req?.history.length).toBe((initial.history.length ?? 0) + 1);
    const last = req!.history[req!.history.length - 1];
    expect(last.changes).toContain('本地模式');
    expect(typeof last.version).toBe('number');
  });
});