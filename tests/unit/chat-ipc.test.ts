/** @jest-environment node */
/**
 * 对话域 IPC 单元测试（chat:send 通道）：
 * - 推理流：转 thinking 事件（累加回放推理过程）
 * - 工具调用 / 工具结果：转 progress 事件（让"💬 开发日志"在 chat 修改模式下也能看到 DSH 过程）
 *
 * Bug 回归保护：修复前 chat:send 在 DSH 调用工具时丢掉了 tool / tool-result 事件，
 * 导致"开发日志"标签永远显示"暂无开发记录"。
 */
jest.mock('electron', () => {
  const mockSend = jest.fn();
  const windows = [{ webContents: { send: mockSend } }];
  return {
    __esModule: true,
    ipcMain: { handle: jest.fn() },
    BrowserWindow: { getAllWindows: () => windows },
    // 通过额外字段把 mockSend 引用暴露给测试（jest hoisting 安全）
    __mockSend: mockSend,
    __mockWindows: windows,
  };
});

import { ipcMain } from 'electron';
import type * as ElectronMock from 'electron';
import { IpcChannels } from '../../src/shared/types/ipc';
import type {
  StorageManager,
  ProjectMeta,
  Requirements,
  ChatMessage,
  ProjectCreateOptions,
} from '../../src/main/storage/types';
import { registerChatIpc } from '../../src/main/ipc/chat';

const electronMock = jest.requireMock('electron') as typeof ElectronMock & {
  __mockSend: jest.Mock;
  __mockWindows: { webContents: { send: jest.Mock } }[];
};
const webContentsSend = electronMock.__mockSend;

/** 收集所有 webContents.send 调用（含 channel 与 payload） */
type Sent = { channel: string; payload: unknown };
let sent: Sent[] = [];

/** 内存版 StorageManager（覆盖 chat:send 用到的接口） */
class FakeStorage implements StorageManager {
  projects = new Map<string, ProjectMeta>();
  reqs = new Map<string, Requirements>();
  histories = new Map<string, ChatMessage[]>();

  async init(): Promise<void> {}
  async createProject(name: string, _options?: ProjectCreateOptions): Promise<ProjectMeta> {
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
  async saveChatMessage(
    projectId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'>,
  ): Promise<ChatMessage> {
    const full: ChatMessage = {
      ...message,
      id: `msg-${(this.histories.get(projectId)?.length ?? 0) + 1}`,
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
  getDefaultProjectsDir(): string {
    return '/fake/projects';
  }
  async ensureProjectDirectories(): Promise<void> {}
}

function getHandler(channel: string): (event: unknown, params: unknown) => Promise<unknown> {
  const call = (ipcMain.handle as jest.Mock).mock.calls.find((c) => c[0] === channel);
  expect(call).toBeDefined();
  return call![1] as (event: unknown, params: unknown) => Promise<unknown>;
}

function getResponseEvents(): { type: string; content?: string }[] {
  return sent
    .filter((s) => s.channel === IpcChannels.chatResponse)
    .map((s) => s.payload as { type: string; content?: string });
}

beforeEach(() => {
  sent = [];
  webContentsSend.mockClear();
  (ipcMain.handle as jest.Mock).mockClear();
  // 简单实现：把每次 send 调用追加到 sent
  webContentsSend.mockImplementation((channel: string, payload: unknown) => {
    sent.push({ channel, payload });
  });
});

describe('对话域 IPC（chat:send）', () => {
  it('推理流：累加回放为连续的 thinking 事件', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    const dsh = {
      runTask: jest.fn(
        async (_path: string, _task: string, onProgress?: (u: unknown) => void) => {
          onProgress?.({ kind: 'reasoning', text: '正在分析需求，' });
          onProgress?.({ kind: 'reasoning', text: '考虑功能列表。' });
          return { reply: '好的', exitCode: 0 };
        },
      ),
    };

    registerChatIpc(storage, dsh as never);
    const handler = getHandler(IpcChannels.chatSend);
    await handler({}, { projectId: meta.id, message: '我想做个记账工具' });

    const thinkingContents = getResponseEvents()
      .filter((e) => e.type === 'thinking')
      .map((e) => e.content);
    expect(thinkingContents.length).toBeGreaterThanOrEqual(2);
    // 最后一个 thinking 应为累加结果
    expect(thinkingContents[thinkingContents.length - 1]).toBe('正在分析需求，考虑功能列表。');
  });

  it('修改模式（ready）：工具调用与结果转为 progress 事件（开发日志可见）', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    await storage.updateProjectMeta(meta.id, { status: 'ready' });
    const dsh = {
      runTask: jest.fn(
        async (_path: string, _task: string, onProgress?: (u: unknown) => void) => {
          // 模拟 DSH 修改代码时的工具调用序列
          onProgress?.({ kind: 'reasoning', text: '读取 index.html' });
          onProgress?.({
            kind: 'tool',
            text: JSON.stringify({ name: 'read_file', arguments: '{"path":"index.html"}' }),
          });
          onProgress?.({ kind: 'tool-result', text: '<html><body>old</body></html>' });
          onProgress?.({
            kind: 'tool',
            text: JSON.stringify({ name: 'write_file', arguments: '{"path":"index.html"}' }),
          });
          onProgress?.({ kind: 'tool-result', text: 'file written' });
          return { reply: '已将页面改好', exitCode: 0 };
        },
      ),
    };

    registerChatIpc(storage, dsh as never);
    const handler = getHandler(IpcChannels.chatSend);
    await handler({}, { projectId: meta.id, message: '把首页改成蓝色主题' });

    const events = getResponseEvents();
    const progressEvents = events.filter((e) => e.type === 'progress');
    // 期望：read_file + 工具结果 + write_file + 工具结果 = 4 条 progress
    expect(progressEvents.map((e) => e.content)).toEqual([
      '📖 读取 index.html',
      '✓ <html><body>old</body></html>',
      '📝 写入 index.html',
      '✓ file written',
    ]);

    // 最终消息事件存在
    expect(events.some((e) => e.type === 'message' && e.content === '已将页面改好')).toBe(true);
  });

  it('需求阶段（draft）：DSH 不调工具时不广播误报的 progress 事件', async () => {
    const storage = new FakeStorage();
    const meta = await storage.createProject('记账本');
    const dsh = {
      runTask: jest.fn(async (_path: string, _task: string, _onProgress?: unknown) => {
        return { reply: '请问谁会用？', exitCode: 0 };
      }),
    };

    registerChatIpc(storage, dsh as never);
    const handler = getHandler(IpcChannels.chatSend);
    await handler({}, { projectId: meta.id, message: '我想做个记账工具' });

    const progressCount = getResponseEvents().filter((e) => e.type === 'progress').length;
    expect(progressCount).toBe(0);
  });
});