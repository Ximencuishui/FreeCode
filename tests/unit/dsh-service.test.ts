import os from 'node:os';
import path from 'node:path';
import { DSHService, extractLastReply } from '../../src/main/dsh/service';

/**
 * DSH 服务层单元测试：用 fake-dsh 夹具模拟 headless 行为。
 */

const FAKE_DSH = path.join(__dirname, 'fixtures', 'fake-dsh.js');

describe('DSH 服务层', () => {
  it('extractLastReply：提取 stdout 最后一条非空文本行', () => {
    expect(extractLastReply('第一行\n\n第二行\n')).toBe('第二行');
    expect(extractLastReply('   \n')).toBe('');
    expect(extractLastReply('你好')).toBe('你好');
  });

  it('runTask：返回 headless 最终回复与退出码', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless'],
    });
    const result = await service.runTask(os.tmpdir(), '帮我生成一个文件');
    expect(result.exitCode).toBe(0);
    expect(result.reply).toBe('模拟回复：你好');
  });

  it('runTask：任务失败时退出码非零', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless', '--crash'],
    });
    const result = await service.runTask(os.tmpdir(), '失败任务');
    expect(result.exitCode).not.toBe(0);
  });
});
