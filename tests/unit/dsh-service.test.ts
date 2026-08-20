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

  it('runTask：deepseek 注入 DEEPSEEK_API_KEY，且输出中的 key 被脱敏', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless'],
      apiKeyProvider: async () => ({ apiKey: 'sk-a1b2c3d4e5f6g7h8i9j0', provider: 'deepseek' }),
    });
    const result = await service.runTask(os.tmpdir(), 'env-check');
    expect(result.exitCode).toBe(0);
    expect(result.reply).toContain('DEEPSEEK_API_KEY');
    expect(result.reply).not.toContain('sk-a1b2c3d4e5f6g7h8i9j0');
    expect(result.reply).toContain('[API_KEY_REDACTED]');
  });

  it('runTask：openai-compatible 注入 OPENAI_* 环境变量', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless'],
      apiKeyProvider: async () => ({
        apiKey: 'sk-openai-key-12345678',
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o-mini',
      }),
    });
    const result = await service.runTask(os.tmpdir(), 'env-check');
    expect(result.exitCode).toBe(0);
    expect(result.reply).toContain('OPENAI_API_KEY');
    expect(result.reply).toContain('https://api.example.com/v1');
    expect(result.reply).not.toContain('sk-openai-key-12345678');
  });

  it('runTask：无凭据时不注入环境变量', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless'],
      apiKeyProvider: async () => null,
    });
    const result = await service.runTask(os.tmpdir(), 'env-check');
    expect(result.reply).toContain('"DEEPSEEK_API_KEY":null');
  });
});
