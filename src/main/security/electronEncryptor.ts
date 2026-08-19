import { safeStorage } from 'electron';
import type { StringEncryptor } from './encryption';

/**
 * 基于 Electron safeStorage 的生产加密器（数据库文档 6.1）。
 * 仅可在 Electron 主进程使用；单元测试请使用 plainEncryptor（encryption.ts）。
 */
export function createSafeStorageEncryptor(): StringEncryptor {
  return {
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
  };
}
