/** @jest-environment node */
/**
 * LLM HTTP 客户端单元测试：覆盖端点拼接、错误归一、超时与 AbortSignal。
 * 全程 mock global.fetch，避免真实网络。
 */

import { LLMClient, LLMError } from '../../src/main/llm/client';

const deepseekCreds = {
  apiKey: 'sk-test-1234567890',
  provider: 'deepseek' as const,
};
const openaiCreds = {
  apiKey: 'sk-test-1234567890',
  provider: 'openai-compatible' as const,
  baseUrl: 'https://example.com/v1',
  model: 'gpt-4o-mini',
};

describe('LLMClient', () => {
  let originalFetch: typeof fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = jest.fn();
    // global.fetch 在 Node 18+ 标准库；测试桩替换它
    (global as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    (global as { fetch: unknown }).fetch = originalFetch;
  });

  it('DeepSeek provider 走默认 baseUrl（https://api.deepseek.com/chat/completions）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '你好' } }] }),
    });
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    const result = await client.call({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('你好');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-1234567890');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string).stream).toBe(false);
  });

  it('openai-compatible provider 用 settings.baseUrl + /v1/chat/completions（用户已带 /v1）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
    });
    const client = new LLMClient({ apiKeyProvider: async () => openaiCreds });
    await client.call({ messages: [{ role: 'user', content: 'hi' }] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/v1/chat/completions');
    expect(JSON.parse(init.body as string).model).toBe('gpt-4o-mini');
  });

  it('openai-compatible baseUrl 不带 /v1 时自动补 /v1/chat/completions', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
    });
    const client = new LLMClient({
      apiKeyProvider: async () => ({
        apiKey: 'sk',
        provider: 'openai-compatible',
        baseUrl: 'https://example.com',
        model: 'custom',
      }),
    });
    await client.call({ messages: [{ role: 'user', content: 'hi' }] });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/v1/chat/completions');
  });

  it('openai-compatible baseUrl 带尾部斜杠时被剥离', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
    });
    const client = new LLMClient({
      apiKeyProvider: async () => ({
        apiKey: 'sk',
        provider: 'openai-compatible',
        baseUrl: 'https://example.com/v1/',
        model: 'custom',
      }),
    });
    await client.call({ messages: [{ role: 'user', content: 'hi' }] });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/v1/chat/completions');
  });

  it('openai-compatible 未配置 baseUrl 时使用 OpenAI 默认地址', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
    });
    const client = new LLMClient({
      apiKeyProvider: async () => ({ apiKey: 'sk', provider: 'openai-compatible' }),
    });
    await client.call({ messages: [{ role: 'user', content: 'hi' }] });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('401 抛 LLMError(AUTH_INVALID)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'invalid key' } }),
    });
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    await expect(client.call({ messages: [] })).rejects.toMatchObject({ code: 'AUTH_INVALID' });
  });

  it('403 抛 LLMError(AUTH_INVALID)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: { message: 'forbidden' } }),
    });
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    await expect(client.call({ messages: [] })).rejects.toMatchObject({ code: 'AUTH_INVALID' });
  });

  it('500 抛 LLMError(LLM_ERROR)，错误信息含 statusText 与后端 message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: { message: 'backend exploded' } }),
    });
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    await expect(client.call({ messages: [] })).rejects.toMatchObject({
      code: 'LLM_ERROR',
      message: expect.stringContaining('500'),
    });
  });

  it('缺 apiKey 时抛 LLMError(API_KEY_MISSING)，不发起 fetch', async () => {
    const client = new LLMClient({ apiKeyProvider: async () => null });
    await expect(client.call({ messages: [] })).rejects.toMatchObject({ code: 'API_KEY_MISSING' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('超时抛 LLMError(TIMEOUT)（timeoutMs=1 触发 fetch abort）', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          // 监听 abort 信号，模拟 fetch 因超时被中断
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const client = new LLMClient({
      apiKeyProvider: async () => deepseekCreds,
      timeoutMs: 1,
    });
    await expect(client.call({ messages: [] })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('调用方 signal 已 aborted 时抛 LLMError(TIMEOUT)，不发起 fetch', async () => {
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.call({ messages: [], signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('调用方 signal 在请求中途 abort 时抛 LLMError(TIMEOUT)', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    const controller = new AbortController();
    const promise = client.call({ messages: [], signal: controller.signal });
    // 立即 abort
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('fetch 抛网络错误（非 AbortError）抛 LLMError(LLM_ERROR)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    await expect(client.call({ messages: [] })).rejects.toMatchObject({ code: 'LLM_ERROR' });
  });

  it('响应 body 不是 JSON 时抛 LLMError(LLM_ERROR)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('Unexpected token');
      },
    });
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    await expect(client.call({ messages: [] })).rejects.toMatchObject({ code: 'LLM_ERROR' });
  });

  it('override model 时以 request.model 为准', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
    });
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    await client.call({ messages: [], model: 'deepseek-coder' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).model).toBe('deepseek-coder');
  });

  it('提取 reasoning_content 字段（DeepSeek 推理模型）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: 'final reply', reasoning_content: 'thinking process' } },
        ],
      }),
    });
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    const result = await client.call({ messages: [] });
    expect(result.content).toBe('final reply');
    expect(result.reasoning).toBe('thinking process');
  });

  it('choices 为空时 content 为空字符串', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    });
    const client = new LLMClient({ apiKeyProvider: async () => deepseekCreds });
    const result = await client.call({ messages: [] });
    expect(result.content).toBe('');
  });

  it('LLMError 是 Error 子类且带 code 字段', () => {
    const e = new LLMError('AUTH_INVALID', 'invalid');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('LLMError');
    expect(e.code).toBe('AUTH_INVALID');
    expect(e.message).toBe('invalid');
  });
});