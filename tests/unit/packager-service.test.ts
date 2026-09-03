/**
 * v3.2.2 P0-5：智能打包取消单测。
 *
 * PackagerService.start 内部分配 ChildProcess 索引到 currentByProject Map。
 * cancel(projectId) 通过 SIGTERM 终止子进程，5 秒兜底 SIGKILL。
 *
 * 策略：在 import PackagerService 前 jest.mock('node:child_process') 替换整个模块。
 */
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const fakeChildren: FakeChild[] = [];

// 必须在 import PackagerService 之前 mock child_process
jest.mock('node:child_process', () => {
  return {
    spawn: jest.fn(() => {
      const c = new FakeChild();
      fakeChildren.push(c);
      return c;
    }),
  };
});

// import 必须在 mock 之后
import { PackagerService } from '../../src/main/package/service';
import type { ProjectMeta } from '../../src/main/storage/types';

class FakeChild extends EventEmitter {
  killed = false;
  killedSignals: string[] = [];
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = Math.floor(Math.random() * 100000);
  kill(signal: string = 'SIGTERM'): boolean {
    this.killed = true;
    this.killedSignals.push(signal);
    setImmediate(() => this.emit('exit', null, signal));
    return true;
  }
}

class FakeStorage {
  project: ProjectMeta | null = null;
  constructor(public baseDir: string) {}
  async getProject(id: string): Promise<ProjectMeta | null> {
    return id === this.project?.id ? this.project : null;
  }
  getProjectDir(id: string): string {
    return path.join(this.baseDir, id);
  }
  getProjectCodePath(id: string): string {
    return path.join(this.baseDir, id, 'code');
  }
}

function makeReadyProject(id = 'proj-1'): ProjectMeta {
  return {
    id,
    name: '测试应用',
    status: 'ready',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    codePath: './code',
    exportCount: 0,
    totalChatMessages: 0,
  };
}

describe('PackagerService 取消（P0-5 + P0-5-2）', () => {
  jest.setTimeout(15000);
  let baseDir: string;
  let storage: FakeStorage;

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-pkg-test-'));
  });

  afterAll(async () => {
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => undefined);
  });

  beforeEach(async () => {
    fakeChildren.length = 0;
    storage = new FakeStorage(baseDir);
    storage.project = makeReadyProject();
    const codePath = storage.getProjectCodePath(storage.project.id);
    await fs.mkdir(codePath, { recursive: true });
    await fs.writeFile(path.join(codePath, 'index.html'), '<h1>test</h1>', 'utf-8');
  });

  // 每个测试结束后清理 FakeChild：手动 emit exit 让 spawnBuilder 的 Promise chain 解开，
  // EventEmitter listeners 释放。否则 runPipeline 的 pending await 会让 jest 觉得 process 没退出。
  afterEach(() => {
    for (const c of fakeChildren) {
      c.emit('exit', null, 'SIGTERM');
    }
    fakeChildren.length = 0;
  });

  it('cancel 未注册的项目返回 false（幂等）', () => {
    const packager = new PackagerService(storage as never);
    expect(packager.cancel('never-started')).toBe(false);
    expect(packager.cancel('never-started')).toBe(false);
  });

  it('cancel 已注册项目调 child.kill(SIGTERM) 并返回 true', async () => {
    const packager = new PackagerService(storage as never);

    const onProgress = jest.fn((evt) => {
      // 收到 electron-builder 阶段说明 spawn 已调
      void evt;
    });
    const onComplete = jest.fn();
    const { packageId } = await packager.start(storage.project!.id, {
      onProgress,
      onComplete,
    });
    // 等 spawn 调用完成（onProgress 第一次出现 electron-builder 阶段即可）
    await waitFor(() => fakeChildren.length > 0, 1000);
    expect(fakeChildren.length).toBe(1);

    const cancelled = packager.cancel(storage.project!.id);
    expect(cancelled).toBe(true);

    await waitFor(() => onComplete.mock.calls.length > 0, 1000);
    const arg = onComplete.mock.calls[0][0];
    expect(arg.packageId).toBe(packageId);
    expect(arg.status).toBe('cancelled');
  });

  it('cancel 后 Map 被清理 → 二次 cancel 返回 false', async () => {
    const packager = new PackagerService(storage as never);
    let completeCount = 0;
    const onComplete = jest.fn(() => {
      completeCount += 1;
    });

    await packager.start(storage.project!.id, { onProgress: jest.fn(), onComplete });
    await waitFor(() => fakeChildren.length > 0, 1000);
    expect(packager.cancel(storage.project!.id)).toBe(true);
    // 等 onComplete 真正被调到（exit 派发 + handler 跑完 → Map delete）
    await waitFor(() => completeCount > 0, 1000);

    expect(packager.cancel(storage.project!.id)).toBe(false);
  });

  it('SIGKILL 兜底：5 秒内 child 未退出 → escalate 为 SIGKILL', async () => {
    const packager = new PackagerService(storage as never);

    // 等到 'electron-builder' 阶段表示 spawn 已调，等拿到 child
    let electronBuilderSeen = false;
    await packager.start(storage.project!.id, {
      onProgress: (evt) => {
        if (evt.stage === 'electron-builder') electronBuilderSeen = true;
      },
      onComplete: jest.fn(),
    });
    await waitFor(() => electronBuilderSeen, 1000);
    const child = fakeChildren[0];
    expect(child).toBeTruthy();

    // 重写 kill 不派发 exit（模拟子进程不响应 SIGTERM/SIGKILL）
    child.kill = jest.fn((sig?: string) => {
      child.killed = true;
      child.killedSignals.push(sig ?? 'SIGTERM');
      return true;
    });

    jest.useFakeTimers();
    try {
      packager.cancel(storage.project!.id);
      // cancel() 立即调 kill('SIGTERM')
      expect(child.killedSignals).toEqual(['SIGTERM']);

      // 5 秒后 escalate 为 SIGKILL
      jest.advanceTimersByTime(5000);
      expect(child.killedSignals).toEqual(['SIGTERM', 'SIGKILL']);
    } finally {
      jest.useRealTimers();
    }
  });
});

/** 简单 poll 等异步状态到位（替代 setTimeout 固定等待）。注意：fake timers 下会失败，
 *  调用方应在 useRealTimers 状态下使用，或改用 setImmediate。 */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor 超时（${timeoutMs}ms）`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}