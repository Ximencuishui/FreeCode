import { IpcChannels } from '../../shared/types/ipc';
import type {
  ApiKeySaveParams,
  ApiKeySaveResult,
  ApiKeyValidateParams,
  ApiKeyValidateResult,
} from '../../shared/types/settings';
import { handleIpc, IpcError } from './helpers';

/**
 * API Key 域 IPC（API 文档 4.6）。
 * WP-03 桩实现：加密存储与真实校验在 WP-05/WP-06（安全模块、设置管理）落地。
 */
export function registerApiKeyIpc(): void {
  handleIpc<ApiKeySaveParams, ApiKeySaveResult>(IpcChannels.apiKeySave, (_event, params) => {
    if (!params?.key?.trim()) {
      throw new IpcError('INVALID_PARAMS', 'API Key 不能为空');
    }
    throw new IpcError('NOT_IMPLEMENTED', 'API Key 保存将在后续版本提供');
  });

  handleIpc<ApiKeyValidateParams, ApiKeyValidateResult>(IpcChannels.apiKeyValidate, (_event, params) => {
    if (!params?.key?.trim()) {
      throw new IpcError('INVALID_PARAMS', 'API Key 不能为空');
    }
    throw new IpcError('NOT_IMPLEMENTED', 'API Key 验证将在后续版本提供');
  });
}
