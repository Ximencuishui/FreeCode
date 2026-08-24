import { CloudDbProvisionError } from './provider';

/**
 * 云服务商 JSON API 调用辅助：
 * - 自动携带 Bearer Token 与 JSON 头
 * - 非 2xx 时解析服务商返回的错误信息并转换为 CloudDbProvisionError
 * - 401/403 映射为 API_KEY_INVALID，其余为 DB_PROVISION_FAILED
 */
export async function cloudFetchJson<T>(
  url: string,
  init: RequestInit,
  apiKey: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
        ...init.headers,
      },
    });
  } catch (err) {
    throw new CloudDbProvisionError(
      'DB_PROVISION_FAILED',
      `无法连接云服务商：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    throw new CloudDbProvisionError(
      response.status === 401 || response.status === 403 ? 'API_KEY_INVALID' : 'DB_PROVISION_FAILED',
      await extractErrorMessage(response),
      { status: response.status },
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new CloudDbProvisionError('DB_PROVISION_FAILED', '云服务商返回了无法解析的响应');
  }
}

/** 从错误响应中提取人类可读信息（优先 JSON 的 message/error 字段，兜底取响应文本） */
async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      message?: string;
      error?: string | { message?: string };
      code?: string;
    };
    const msg =
      typeof body.error === 'string'
        ? body.error
        : body.message ?? body.error?.message ?? body.code ?? '';
    if (msg) return `云服务商错误：${msg}`;
  } catch {
    // 非 JSON 响应，走文本兜底
  }
  try {
    const text = (await response.text()).trim();
    if (text) return `云服务商错误（HTTP ${response.status}）：${text.slice(0, 200)}`;
  } catch {
    // 忽略
  }
  return `云服务商请求失败（HTTP ${response.status}）`;
}
