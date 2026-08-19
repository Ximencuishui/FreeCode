import path from 'node:path';
import {
  DSHProcessManager,
  type DSHOutput,
} from '../../src/main/dsh/manager';

/**
 * DSH 进程管理器单元测试。
 * 使用 fake-dsh 子进程夹具模拟真实 dsh CLI（测试计划 5.2.2 IT-DSH 思路）。
 */

const FAKE_DSH = path.join(__dirname, 'fixtures', 'fake-dsh.js');

function waitForExit(manager: DSHProcessManager, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待进程退出超时')), timeout);
    manager.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function waitFor(condition: () => boolean, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('等待条件超时'));
      }
    }, 25);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DSH 进程管理器', () => {
  it('IT-DSH-001 启动：进程运行，状态流转 running → stopped', async () => {
    const manager = new DSHProcessManager({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless', '生成一个文件'],
    });
    manager.start();

    expect(manager.getStatus()).toBe('running');
    expect(manager.getPid()).not.toBeNull();

    await waitForExit(manager);
    expect(manager.getStatus()).toBe('stopped');
  });

  it('IT-DSH-002 输出捕获：stdout 内容可监听并累积', async () => {
    const manager = new DSHProcessManager({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless', '任务'],
    });
    const outputs: DSHOutput[] = [];
    manager.on('output', (o: DSHOutput) => outputs.push(o));
    manager.start();

    await waitForExit(manager);
    expect(outputs.some((o) => o.data.includes('模拟回复：你好'))).toBe(true);
    expect(manager.getStdout()).toContain('模拟回复：你好');
  });

  it('IT-DSH-003 停止：挂起进程被终止，状态为 stopped', async () => {
    const manager = new DSHProcessManager({
      command: [process.execPath, FAKE_DSH, '--hang'],
    });
    manager.start();
    await delay(200);

    await manager.stop();
    expect(manager.getStatus()).toBe('stopped');
    expect(manager.getPid()).toBeNull();
  });

  it('IT-DSH-004 崩溃自动重启：非预期退出后拉起新进程', async () => {
    const manager = new DSHProcessManager({
      command: [process.execPath, FAKE_DSH, '--crash'],
      autoRestart: true,
      maxRestarts: 2,
    });
    manager.start();

    await waitFor(() => manager.getRestartCount() >= 1);
    expect(manager.getRestartCount()).toBe(1);
    expect(manager.getStatus()).toBe('running');

    await manager.stop();
  });

  it('IT-DSH-005 非零退出（autoRestart=false）：状态为 error，不重启', async () => {
    const manager = new DSHProcessManager({
      command: [process.execPath, FAKE_DSH, '--crash'],
    });
    manager.start();

    await waitForExit(manager);
    expect(manager.getRestartCount()).toBe(0);
    expect(manager.getStatus()).toBe('error');
  });
});
