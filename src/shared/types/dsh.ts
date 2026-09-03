/** dsh 运行时状态（API 文档补充：方案 3 落地）。 */

/**
 * dsh 运行时状态机。
 * - 'loading' 仅用于渲染层 useDshState 的 INITIAL（主进程未回 IPC 快照之前），让徽章
 *   显示骨架态而非假装"已就绪"（初始 0~几百毫秒内 IPC 尚未往返）；主进程
 *   DSHService.computeState() 永远不会返回该状态，类型上仅在 INITIAL 出现。
 * - 'idle' 启动入口齐了 + 当前没有任务在跑（= "休眠中"）
 * - 'starting' 子进程 spawn 中，未拿到首批输出
 * - 'running' 有任务在跑
 * - 'stopping' 用户主动停止中
 * - 'error' 上一次任务退出非零 / spawn 失败
 * - 'missing' 启动入口缺失（资源/文件不存在），是持续态，与 error 不同
 */
export type DSHRunStatus =
  | 'loading'
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'
  | 'missing';

export interface DSHState {
  /** 启动入口是否就绪（二进制存在 + 命令可解析） */
  available: boolean;
  /** 聚合后的运行时状态（多 manager 并发时取最高优先级） */
  status: DSHRunStatus;
  /** 当前活跃的 dsh 子进程数量 */
  busyCount: number;
  /** 人类可读的简短描述（用于状态栏副标题/title） */
  message: string;
  /** 失败/缺失原因（仅 status='missing' 或 'error' 时填充） */
  reason?: string;
}
