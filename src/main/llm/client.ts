/**
 * LLM HTTP 客户端：直接调用 DeepSeek / OpenAI 兼容 API。
 *
 * 设计要点：
 * - 与 DSH（DeepSeek Harness）解耦：DSH 是开发引擎，需求调研阶段不需要启动子进程，
 *   走「轻量一次性 chat completion」即可；
 * - 复用 storage.loadApiKey() + storage.getSettings() 拿凭据，与 DSHService 的
 *   apiKeyProvider 写法保持一致；
 * - 第一版只做非流式（stream: false）：破冰是 5~15 秒短回答，UX 上加 'thinking'
 *   跑马灯 + 心跳已够用，避免引入流式复杂度；
 * - 错误归一为 LLMError(code, message)，让上层（runSkill）按 code 分流。
 */

import type { LlmProviderKind } from '../../shared/types/settings';

/** LLM 凭据（与 DSHService.DSHCredentials 保持同形，方便主入口一处构造） */
export interface LLMCredentials {
  apiKey: string;
  provider: LlmProviderKind;
  baseUrl?: string;
  model?: string;
}

export interface LLMClientOptions {
  /**
   * 大模型凭据提供者：返回本地加密存储的 key 与提供商配置。
   * 返回 null 表示尚未配置 API Key。
   */
  apiKeyProvider: () => Promise<LLMCredentials | null>;
  /** 默认模型；provider=deepseek 时取 settings.model ?? 默认值 */
  defaultModel?: string;
  /** 单次请求超时（毫秒），默认 30s */
  timeoutMs?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  /**
   * 流式增量回调（第一版仅做非流式，留 TODO；调用方仍可传入以保持 API 稳定，
   * 后续接入流式时无需改 skill 调用方）。
   */
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
  /** 期望最大输出 token；破冰场景默认 800 */
  maxTokens?: number;
  /** 覆盖默认模型（skill 可按场景临时指定） */
  model?: string;
}

export interface LLMResult {
  content: string;
  /** 模型推理过程（DeepSeek 等多数模型没有 reasoning_content，第一版留接口） */
  reasoning?: string;
}

/** LLM 错误码（与 IPC 错误码体系分开，llm 内部细分；runSkill 统一映射） */
export type LLMErrorCode =
  | 'API_KEY_MISSING'
  | 'AUTH_INVALID'
  | 'TIMEOUT'
  | 'LLM_ERROR';

/** LLM 调用相关错误（无 electron 依赖，可在 jest node 环境安全引入） */
export class LLMError extends Error {
  constructor(
    public readonly code: LLMErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/** DeepSeek 默认 baseUrl */
const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
/** OpenAI 默认 baseUrl（用户未配置 baseUrl 时使用） */
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com';
/** 默认模型 */
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
/** 默认超时 */
const DEFAULT_TIMEOUT_MS = 30 * 1000;

/** DeepSeek / OpenAI 兼容 chat completions 响应（仅取必要字段） */
interface ChatCompletionsResponse {
  choices?: Array<{
    message?: { content?: string; reasoning_content?: string };
    finish_reason?: string;
  }>;
  error?: { message?: string; type?: string };
}

export class LLMClient {
  private readonly apiKeyProvider: () => Promise<LLMCredentials | null>;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(options: LLMClientOptions) {
    this.apiKeyProvider = options.apiKeyProvider;
    // defaultModel 仅作为 settings.model 缺失时的回退；与 provider 无关，统一存一个字符串
    this.defaultModel = options.defaultModel ?? DEFAULT_DEEPSEEK_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * 发送一次 chat completion 请求；走 OpenAI 兼容协议（DeepSeek / 自定义均可）。
   * 返回 LLMResult.content（模型回复正文）。
   * 抛出 LLMError(code, message)；调用方根据 code 决定重试 / 广播 / 静默。
   */
  async call(request: LLMRequest): Promise<LLMResult> {
    // 1. 凭据检查：未接入大模型 API 时无法工作，抛业务错误（runSkill 据此静默处理）
    const creds = await this.apiKeyProvider();
    if (!creds?.apiKey) {
      throw new LLMError('API_KEY_MISSING', '尚未配置大模型 API Key');
    }

    // 2. 计算端点 + 模型
    const { url, model } = this.resolveEndpoint(creds, request.model);

    // 3. 构造请求体（非流式）
    const body = {
      model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      stream: false,
    };

    // 4. 发送请求（带超时 + AbortSignal 支持）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    // 外部 signal abort 时也一并终止 fetch
    const onExternalAbort = () => controller.abort();
    if (request.signal) {
      if (request.signal.aborted) {
        clearTimeout(timeoutId);
        throw new LLMError('TIMEOUT', '请求已取消');
      }
      request.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      // AbortError 来自 fetch（超时 / 外部 signal）
      if (error instanceof Error && error.name === 'AbortError') {
        if (request.signal?.aborted) {
          throw new LLMError('TIMEOUT', '请求已取消');
        }
        throw new LLMError('TIMEOUT', `LLM 请求超时（${this.timeoutMs}ms）`);
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new LLMError('LLM_ERROR', `LLM 请求失败：${reason}`);
    } finally {
      if (request.signal) {
        request.signal.removeEventListener('abort', onExternalAbort);
      }
    }
    clearTimeout(timeoutId);

    // 5. 错误归一：4xx/5xx
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new LLMError('AUTH_INVALID', 'API Key 无效或已过期');
      }
      let detail = response.statusText;
      try {
        const errBody = (await response.json()) as ChatCompletionsResponse;
        if (errBody.error?.message) {
          detail = `${response.statusText}：${errBody.error.message}`;
        }
      } catch {
        /* body 不是 JSON，保留 statusText */
      }
      throw new LLMError('LLM_ERROR', `LLM 请求失败（${response.status} ${detail}）`);
    }

    // 6. 解析响应
    let payload: ChatCompletionsResponse;
    try {
      payload = (await response.json()) as ChatCompletionsResponse;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new LLMError('LLM_ERROR', `LLM 响应解析失败：${reason}`);
    }

    const content = payload.choices?.[0]?.message?.content ?? '';
    const reasoning = payload.choices?.[0]?.message?.reasoning_content;
    return {
      content,
      reasoning: reasoning ?? undefined,
    };
  }

  /**
   * 根据 provider 解析请求端点与模型。
   * - deepseek → https://api.deepseek.com/chat/completions（固定，不读取 baseUrl）
   * - openai-compatible → (baseUrl ?? 默认)/v1/chat/completions
   */
  private resolveEndpoint(creds: LLMCredentials, overrideModel?: string): { url: string; model: string } {
    if (creds.provider === 'deepseek') {
      const url = `${DEEPSEEK_DEFAULT_BASE_URL}/chat/completions`;
      const model = overrideModel ?? creds.model ?? this.defaultModel ?? DEFAULT_DEEPSEEK_MODEL;
      return { url, model };
    }
    const baseUrl = creds.baseUrl?.trim() || OPENAI_DEFAULT_BASE_URL;
    // 与 apikey.ts::normalizeModelsUrl 同思路：用户填的 baseUrl 可能已经含 /v1 后缀，
    // 也可能没有；统一保证拼接后是 /v1/chat/completions，避免双 /v1。
    const trimmed = baseUrl.replace(/\/+$/, '');
    const url = trimmed.endsWith('/v1')
      ? `${trimmed}/chat/completions`
      : `${trimmed}/v1/chat/completions`;
    const model = overrideModel ?? creds.model ?? DEFAULT_OPENAI_MODEL;
    return { url, model };
  }
}