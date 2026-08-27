import { IpcChannels } from '../../shared/types/ipc';
import type {
  ApiKeySaveParams,
  ApiKeySaveResult,
  ApiKeyTestParams,
  ApiKeyTestResult,
  ApiKeyValidateParams,
  ApiKeyValidateResult,
  LlmProviderKind,
} from '../../shared/types/settings';
import type { StorageManager } from '../storage/types';
import { handleIpc, IpcError } from './helpers';

/** DeepSeek API Key 格式（宽松校验；真实有效性由 apikey:test 的 /models 请求验证） */
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

// ========== API Key 连接测试 ==========

/** 连接测试超时（毫秒） */
const TEST_TIMEOUT_MS = 10_000;

/** 规整为端点 /models 地址（兼容 /v1 前缀与尾部斜杠） */
function normalizeModelsUrl(baseUrl: string | undefined): string {
  const base = (baseUrl?.trim() || 'https://api.deepseek.com').replace(/\/+$/, '');
  return `${base}/models`;
}

interface ModelsBody {
  data?: { id?: string }[];
}

/**
 * 真实连接测试：GET {baseUrl}/models 校验 API Key 有效性。
 * - 2xx：Key 有效，返回耗时与可用模型列表（部分端点不返回）
 * - 401/403：Key 无效/被禁用
 * - 其他：按状态码给出可读错误；网络异常/超时也归类为失败
 */
async function testConnection(params: ApiKeyTestParams): Promise<ApiKeyTestResult> {
  const provider: LlmProviderKind =
    params?.provider === 'openai-compatible' ? 'openai-compatible' : 'deepseek';
  const key = (params?.key ?? '').trim();
  const message = validateKey(provider, key);
  if (message) return { success: false, message };
  const baseUrlMessage = validateBaseUrl(params?.baseUrl);
  if (baseUrlMessage) return { success: false, message: baseUrlMessage };

  const url = normalizeModelsUrl(params?.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (res.status === 401 || res.status === 403) {
      return {
        success: false,
        message: `API Key 无效或已被禁用（HTTP ${res.status}）`,
        latencyMs,
      };
    }
    if (!res.ok) {
      return { success: false, message: `连接失败（HTTP ${res.status}）`, latencyMs };
    }
    let models: string[] | undefined;
    try {
      const body = (await res.json()) as ModelsBody;
      if (Array.isArray(body.data)) {
        models = body.data.map((m) => m.id).filter((x): x is string => Boolean(x));
      }
    } catch {
      /* 非 JSON 响应不影响成功判定 */
    }
    return { success: true, message: '连接成功', latencyMs, models };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      success: false,
      message: aborted
        ? `连接超时（超过 ${TEST_TIMEOUT_MS / 1000} 秒）`
        : `无法连接到端点：${err instanceof Error ? err.message : String(err)}`,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** API Key 域 IPC（API 文档 4.6），safeStorage 加密存储；保存前先做真实连接测试 */
export function registerApiKeyIpc(storage: StorageManager): void {
  handleIpc<ApiKeyTestParams, ApiKeyTestResult>(IpcChannels.apiKeyTest, async (_event, params) => {
    return testConnection(params ?? { key: '' });
  });

  handleIpc<ApiKeySaveParams, ApiKeySaveResult>(IpcChannels.apiKeySave, async (_event, params) => {
    const provider: LlmProviderKind = params?.provider === 'openai-compatible' ? 'openai-compatible' : 'deepseek';
    const key = (params?.key ?? '').trim();
    if (key) {
      const message = validateKey(provider, key);
      if (message) {
        throw new IpcError('INVALID_PARAMS', message);
      }
    } else {
      // 未输入新 Key：仅在已有配置时允许（只更新提供商/Base URL/模型，保留原 Key）
      const existing = await storage.loadApiKey();
      if (!existing) {
        throw new IpcError('INVALID_PARAMS', 'API Key 不能为空');
      }
    }
    const baseUrlMessage = validateBaseUrl(params?.baseUrl);
    if (baseUrlMessage) {
      throw new IpcError('INVALID_PARAMS', baseUrlMessage);
    }

    if (key) {
      await storage.saveApiKey(key);
    }
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
