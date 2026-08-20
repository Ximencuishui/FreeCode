import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStorageManager } from '../../src/main/storage';
import { plainEncryptor, sanitizeLog } from '../../src/main/security/encryption';
import { IpcChannels } from '../../src/shared/types/ipc';

/**
 * 安全测试（测试计划 9.1 ST-001/003/004 逻辑级）。
 * ST-002（内存安全）与 ST-005（预览沙箱）见 E2E/集成层。
 */

describe('安全测试（ST）', () => {
  it('ST-001 API Key 存储安全：存储文件不含明文', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-sec-'));
    try {
      const storage = new FileStorageManager(dir, plainEncryptor);
      await storage.init();
      const key = 'sk-test-abcdef1234567890';
      await storage.saveApiKey(key);

      const content = await fs.readFile(path.join(dir, 'api-key.encrypted'), 'utf-8');
      expect(content).not.toContain(key);
      // 内容为 base64 编码（非明文）
      expect(content).toMatch(/^[A-Za-z0-9+/=]+$/);

      // 解密后恢复
      expect(await storage.loadApiKey()).toBe(key);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('ST-003 日志脱敏：日志文件不输出 API Key', () => {
    const raw = '请求失败 key=sk-abcdef1234567890ABCDEF 请重试';
    const sanitized = sanitizeLog(raw);
    expect(sanitized).not.toContain('sk-abcdef1234567890ABCDEF');
    expect(sanitized).toContain('[API_KEY_REDACTED]');
  });

  it('ST-004 IPC 通道完整性：定义齐全且 preload 白名单引用', async () => {
    const root = process.cwd();
    const ipcSource = await fs.readFile(path.join(root, 'src', 'shared', 'types', 'ipc.ts'), 'utf-8');
    const preloadSource = await fs.readFile(path.join(root, 'src', 'preload', 'index.ts'), 'utf-8');

    const channels = Object.values(IpcChannels);
    expect(channels.length).toBeGreaterThanOrEqual(21);
    // 通道名在常量定义中齐全
    for (const channel of channels) {
      expect(ipcSource).toContain(channel);
    }
    // preload 通过 IpcChannels 白名单引用（不直接拼接通道字符串）
    expect(preloadSource).toContain('IpcChannels');
  });
});
