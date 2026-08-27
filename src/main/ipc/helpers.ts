import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ErrorCode, FreeCoderError } from '../../shared/types/ipc';
import { DSHError } from '../dsh/errors';

/** 业务异常：携带统一错误码 */
export class IpcError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

function toErrorResponse(err: unknown): { success: false; error: FreeCoderError } {
  if (err instanceof IpcError) {
    return {
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
  }
  // DSH 领域错误（API Key 缺失 / dsh 运行时缺失 / 超时）映射为统一错误码
  if (err instanceof DSHError) {
    return {
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
  }
  return {
    success: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message: err instanceof Error ? err.message : '未知错误',
    },
  };
}

/**
 * 统一注册 invoke 型 IPC 处理器：捕获异常并转换为统一错误响应（API 文档 5.3）。
 * 处理器签名：handler(event, params) → 响应对象。
 */
export function handleIpc<TParams, TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, params: TParams) => TResult | Promise<TResult>,
): void {
  ipcMain.handle(channel, async (event, params: TParams) => {
    try {
      return await handler(event, params);
    } catch (err) {
      return toErrorResponse(err);
    }
  });
}
