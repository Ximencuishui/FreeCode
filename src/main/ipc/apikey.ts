import { IpcChannels } from '../../shared/types/ipc';
import type {
  ApiKeySaveParams,
  ApiKeySaveResult,
  ApiKeyValidateParams,
  ApiKeyValidateResult,
} from '../../shared/types/settings';
import type { StorageManager } from '../storage/types';
import { handleIpc, IpcError } from './helpers';

/** DeepSeek API Key 格式（宽松校验，真实有效性验证在 WP-08 通过 DSH 联调落地） */
const API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/;

/** API Key 域 IPC（API 文档 4.6），safeStorage 加密存储 */
export function registerApiKeyIpc(storage: StorageManager): void {
  handleIpc<ApiKeySaveParams, ApiKeySaveResult>(IpcChannels.apiKeySave, async (_event, params) => {
    if (!params?.key?.trim()) {
      throw new IpcError('INVALID_PARAMS', 'API Key 不能为空');
    }
    await storage.saveApiKey(params.key.trim());
    return { success: true };
  });

  handleIpc<ApiKeyValidateParams, ApiKeyValidateResult>(
    IpcChannels.apiKeyValidate,
    async (_event, params) => {
      if (!params?.key?.trim()) {
        throw new IpcError('INVALID_PARAMS', 'API Key 不能为空');
      }
      const key = params.key.trim();
      if (!API_KEY_PATTERN.test(key)) {
        return { valid: false, message: 'API Key 格式不正确' };
      }
      return { valid: true };
    },
  );
}
