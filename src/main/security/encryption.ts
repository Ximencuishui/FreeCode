/**
 * 安全模块（纯逻辑，无 Electron 依赖，可单元测试）。
 * 加密实现见 electronEncryptor.ts（主进程专用）。
 */

/** 字符串加解密器抽象：明文 ↔ base64 密文 */
export interface StringEncryptor {
  encrypt(plain: string): string;
  decrypt(encrypted: string): string;
}

/** 严格 base64 校验：非法输入抛错（模拟 safeStorage 对损坏数据的失败行为） */
function decodeStrictBase64(input: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input) || input.length % 4 !== 0) {
    throw new Error('Invalid encrypted data');
  }
  return Buffer.from(input, 'base64');
}

/** 测试用明文加密器（base64 编码，仅用于隔离环境） */
export const plainEncryptor: StringEncryptor = {
  encrypt: (plain) => Buffer.from(plain, 'utf-8').toString('base64'),
  decrypt: (encrypted) => decodeStrictBase64(encrypted).toString('utf-8'),
};

/** 日志/错误信息脱敏：隐藏 API Key 等敏感信息（数据库文档 6.2） */
export function sanitizeLog(data: string): string {
  return data.replace(/sk-[A-Za-z0-9_-]{16,}/g, '[API_KEY_REDACTED]');
}
