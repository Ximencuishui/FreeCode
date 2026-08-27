/**
 * DSH 领域错误：与 electron 无依赖（可在 jest node 环境下安全引入）。
 * IPC 层（ipc/helpers.ts）负责将其转换为统一的 FreeCoderError 响应。
 */

export type DSHErrorCode =
  | 'API_KEY_MISSING'
  | 'DSH_START_FAILED'
  | 'DSH_TIMEOUT'
  | 'TASK_CANCELLED'
  /** 大模型 API 触发了速率/额度限制（DSH 子进程把错误透传到 stdout，被识别为噪音后翻译为友好提示） */
  | 'RATE_LIMIT';

/** DSH 任务执行相关错误（API Key 缺失 / 运行时缺失 / 超时等） */
export class DSHError extends Error {
  constructor(
    public readonly code: DSHErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DSHError';
  }
}
