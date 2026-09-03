import type { DSHState, DSHRunStatus } from '@shared/types/dsh';

/**
 * 状态栏右下角 dsh 状态徽章（方案 3 落地）。
 *
 *  - loading     → 灰色骨架态（仅渲染层 useDshState INITIAL 用，主进程不会推送）。
 *  - idle        → 灰色静态徽章，显示"💤 休眠中"。这是常态（启动入口齐了 + 当前无任务）。
 *  - starting / running / stopping
 *               → 蓝色 + 脉冲点，显示"dsh 启动中…" / "dsh 任务进行中" / "dsh 停止中"。
 *  - error       → 黄色警告徽章 + 上次任务异常原因。
 *  - missing     → 黄色警告徽章 + 启动入口缺失的具体原因（PATH 没 dsh / 内置 bin.js 缺失 / 等）。
 *
 * 注意：missing 与 error 文案都是"非正常态"，均用 ⚠ + 黄色背景，与 idle 形成视觉对比。
 *
 * 设计上 prefers-reduced-motion 用户（系统设置了减少动效）也会看到脉冲点静态版。
 */
export function DshStatusBadge({ state }: { state: DSHState }): JSX.Element {
  const status: DSHRunStatus = state.status;
  switch (status) {
    case 'missing':
      return (
        <span
          className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-600"
          title={state.reason ?? state.message}
        >
          ⚠ {state.reason ? `${state.message}（${state.reason}）` : state.message}
        </span>
      );

    case 'error':
      return (
        <span
          className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-600"
          title={state.message}
        >
          ⚠ {state.message}
        </span>
      );

    case 'starting':
    case 'running':
    case 'stopping':
      return (
        <span
          className="ml-2 flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-blue-600"
          title={state.message}
        >
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500"
            aria-hidden="true"
          />
          <span>{state.message}</span>
        </span>
      );

    case 'loading':
      // IPC 尚未往返（mount 后 0~几百毫秒内）：灰色骨架态，明确告诉用户"在读，不是就绪"。
      // 真实快照到达后会被真实状态替换（idle / missing / 等）。
      return (
        <span
          className="ml-2 flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-400"
          title={state.message}
        >
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-300"
            aria-hidden="true"
          />
          <span>{state.message}</span>
        </span>
      );

    case 'idle':
    default:
      // idle 是最常见的常态态：灰色静态徽章 + "💤 休眠中"。hover 提示解释按需启动
      return (
        <span
          className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500"
          title="dsh 待命中 · 触发任务时自动启动"
        >
          💤 {state.message}
        </span>
      );
  }
}
