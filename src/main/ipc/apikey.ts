import { IpcChannels } from '../../shared/types/ipc';
import type {
  ApiKeySaveParams,
  ApiKeySaveResult,
  ApiKeyValidateParams,
  ApiKeyValidateResult,
  LlmProviderKind,
} from '../../shared/types/settings';
import type { StorageManager } from '../storage/types';
import { handleIpc, IpcError } from './helpers';

/** DeepSeek API Key 格式（宽松校验，真实有效性验证在 WP-08 通过 DSH 联调落地） */
const DEEPSEEK_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/;

/** OpenAI 兼容接口的 key 只要求非空且长度足够 */
function validateKey(provider: LlmProviderKind, key: string): string | null {
  const k = key.trim();
  if (!k) return 'API Key 不能为空';
  if (provider === 'deepseek' && !DEEPSEEK_KEY_PATTERN.test(k)) {
    return 'DeepSeek API Key 格式不正确（应以 sk- 开头）';
  }
  if (k.length < 8) return 'API Key 长度不足';
  return null;
}

/** 自定义 Base URL 仅允许 http(s)（供 WP-08 写入 DSH settings.yaml） */
function validateBaseUrl(baseUrl: string | undefined): string | null {
  const b = baseUrl?.trim();
  if (!b) return null;
  if (!/^https?:\/\//i.test(b)) return 'Base URL 必须以 http(s):// 开头';
  return null;
}

/** API Key 域 IPC（API 文档 4.6），safeStorage 加密存储 */
export function registerApiKeyIpc(storage: StorageManager): void {
  handleIpc<ApiKeySaveParams, ApiKeySaveResult>(IpcChannels.apiKeySave, async (_event, params) => {
    const provider: LlmProviderKind = params?.provider === 'openai-compatible' ? 'openai-compatible' : 'deepseek';
    const message = validateKey(provider, params?.key ?? '');
    if (message) {
      throw new IpcError('INVALID_PARAMS', message);
    }
    const baseUrlMessage = validateBaseUrl(params?.baseUrl);
    if (baseUrlMessage) {
      throw new IpcError('INVALID_PARAMS', baseUrlMessage);
    }

    await storage.saveApiKey(params.key.trim());
    // 一并持久化提供商配置（baseUrl / model 供 WP-08 写入 DSH settings.yaml）
    await storage.saveSettings({
      provider,
      baseUrl: params.baseUrl?.trim() || undefined,
      model: params.model?.trim() || undefined,
    });
    return { success: true };
  });

  handleIpc<ApiKeyValidateParams, ApiKeyValidateResult>(
    IpcChannels.apiKeyValidate,
    async (_event, params) => {
      const provider: LlmProviderKind = params?.provider === 'openai-compatible' ? 'openai-compatible' : 'deepseek';
      const message = validateKey(provider, params?.key ?? '');
      return message ? { valid: false, message } : { valid: true };
    },
  );
}
