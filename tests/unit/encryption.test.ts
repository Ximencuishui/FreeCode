import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { plainEncryptor, sanitizeLog } from '../../src/main/security/encryption';
import { FileStorageManager } from '../../src/main/storage';

/**
 * 安全模块单元测试（测试计划 4.2.4 UT-ENC-001~004）。
 * 使用 plainEncryptor 隔离 Electron safeStorage（不可在 Node 单测环境使用）。
 */

describe('安全模块（UT-ENC）', () => {
  it('UT-ENC-001 API Key 加密：加密后不等于原文', () => {
    const key = 'sk-test-1234567890abcdef';
    const encrypted = plainEncryptor.encrypt(key);
    expect(encrypted).not.toBe(key);
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('UT-ENC-002 API Key 解密：解密后等于原文', () => {
    const key = 'sk-test-1234567890abcdef';
    expect(plainEncryptor.decrypt(plainEncryptor.encrypt(key))).toBe(key);
  });

  it('UT-ENC-003 无 Key 时加载：返回 null，不抛异常', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-test-'));
    try {
      const storage = new FileStorageManager(dir, plainEncryptor);
      await storage.init();
      await expect(storage.loadApiKey()).resolves.toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-ENC-004 损坏数据解密：不崩溃（loadApiKey 返回 null）', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-test-'));
    try {
      const storage = new FileStorageManager(dir, plainEncryptor);
      await storage.init();
      await fs.writeFile(path.join(dir, 'api-key.encrypted'), '!!!corrupted!!!', 'utf-8');
      await expect(storage.loadApiKey()).resolves.toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-ENC-005 日志脱敏：API Key 被替换', () => {
    const raw = '请求失败 key=sk-abcdef1234567890ABCDEF 请重试';
    expect(sanitizeLog(raw)).toContain('[API_KEY_REDACTED]');
    expect(sanitizeLog(raw)).not.toContain('sk-abcdef1234567890ABCDEF');
  });
});
