import { safeStorage } from 'electron';
import { plainEncryptor, type StringEncryptor } from './encryption';

/**
 * 基于 Electron safeStorage 的生产加密器（数据库文档 6.1）。
 * 仅可在 Electron 主进程使用；单元测试请使用 plainEncryptor（encryption.ts）。
 * 若系统无可用的安全存储（如 Linux 无 keyring），降级为明文 base64 并告警，
 * 保证功能可用（数据仍仅存本地）。
 */
export function createSafeStorageEncryptor(): StringEncryptor {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[FreeCoder] safeStorage 不可用（如 Linux 缺少 keyring），API Key 将降级为本地 base64 存储');
    return plainEncryptor;
  }
  return {
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
  };
}
