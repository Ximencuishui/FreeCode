import { useEffect, useState } from 'react';
import type { AutoTestPlanStep } from '@shared/types/project';
import Marquee from '../Marquee';
import {
  estimateRemainingMs,
  formatDuration,
  isOvertime,
  progressPercent,
} from './autoTestProgress';

interface AutoTestPlanCardProps {
  plan: AutoTestPlanStep[];
  currentStep: number;
  startedAt: number | null;
  expectedDurationMs: number;
  latestProgress?: string | null;
  /** 测试已完成：用于关闭剩余时间提示、显示实际总耗时 */
  finished?: boolean;
  totalDurationMs?: number;
  dataTestid?: string;
  /**
   * v3.2.1 P2-12：超时（overtime）状态下的"立即中断"入口回调。
   * 父组件传 `() => void`，卡片会在 overtime 文案右侧渲染一个小按钮触发，
   * 让用户在测试明显卡住时不必依赖 InterruptBanner 也能立刻终止任务。
   * 不传则不渲染按钮（兼容历史使用方）。
   */
  onStop?: () => void;
}

/**
 * 自动测试计划卡片：实时展示 5 步测试进度、当前步骤、已用时/预计剩余时间。
 *
 * - 渲染位置：chat 视图主对话流 / preview 视图 AssistantPanel 进度 Tab
 * - 状态来源：chat store 的 autoTestPlan / autoTestCurrentStep / autoTestStartedAt
 * - 友好提示：测试进行中时提示「可以去干其他事情，约 X 秒后会自动完成」
 */
export default function AutoTestPlanCard({
  plan,
  currentStep,
  startedAt,
  expectedDurationMs,
  latestProgress,
  finished = false,
  totalDurationMs,
  dataTestid,
  onStop,
}: AutoTestPlanCardProps) {
  const total = plan.length;
  // v3.2.1 P1-4 修复：原来仅用 setInterval 每秒触发 setTick，但 Electron 窗口最小化时
  // Chromium 把 setInterval 节流到 1Hz（甚至更低）。用户切回窗口时 `now - startedAt`
  // 是真实值，但 `tick` 落后 → UI 跳秒/闪一下"已超出预估"，体验差。
  // 改用 Page Visibility API：visible 状态正常每秒 tick；hidden 时暂停 tick，
  // 但 Date.now() 仍按真实时间走，回 visible 时第一次 render 就刷新到准确值。
  const [, setTick] = useState(0);
  useEffect(() => {
    if (finished) return undefined;
    let timer: number | null = null;
    const startTick = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    };
    const stopTick = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // 回前台立刻触发一次 tick，避免视觉上"卡几秒才刷新"
        setTick((t) => t + 1);
        startTick();
      } else {
        stopTick();
      }
    };
    if (document.visibilityState === 'visible') startTick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopTick();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [finished]);

  // v3.2.1 P1-4 优化：动态预估修正。当实际已用时已超过初始预估时，
  // 把"剩余时间"基准修正为「当前已用时 + 50% 缓冲」，避免"已超出预估 X 秒"长时间存在。
  // 这是基于经验的启发式，不是承诺；目的是让长任务仍有"还要多久"的合理预期。
  const now = Date.now();
  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const baseExpectedMs =
    !finished && startedAt && elapsedMs > expectedDurationMs
      ? Math.round(elapsedMs * 1.5)
      : expectedDurationMs;
  const remainingMs = finished
    ? 0
    : estimateRemainingMs(baseExpectedMs, startedAt, now, finished);
  // 已超出预估（剩余时间为负）：渲染「已超出预估 X 秒」而非「预计还需 0 秒」，
  // 避免给用户「马上要结束」的错觉
  const overtimeMs = !finished && remainingMs < 0 ? Math.abs(remainingMs) : 0;
  const isOver = isOvertime(baseExpectedMs, startedAt, now, finished);
  const percent = progressPercent(finished ? total : Math.max(currentStep + 1, 0), total);

  // 步骤状态点：done / active / todo
  const statusOf = (idx: number): 'done' | 'active' | 'todo' => {
    if (finished) return 'done';
    if (idx < currentStep) return 'done';
    if (idx === currentStep) return 'active';
    return 'todo';
  };

  return (
    <div
      data-testid={dataTestid ?? 'auto-test-plan-card'}
      // v3.2.1 P1-4：屏幕阅读器要朗读"第 3 步进行中""已超出预估"等关键状态变化，
      // aria-live="polite" + aria-atomic="true" 让内容变更时整体朗读一次，不打断当前朗读。
      // 同时 P2-9：加深 amber 背景 + 文字对比度（原 bg-amber-50/70 在浅色模式下偏弱）。
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="rounded-xl border border-amber-300 bg-amber-100/80 px-4 py-3 text-sm leading-relaxed text-amber-950"
    >
      {/* 顶部：标题 + 进度条 */}
      <div className="flex items-center justify-between">
        <p className="font-medium text-amber-800">
          🧪 自动测试计划 ·{' '}
          {finished
            ? '已完成'
            : currentStep < 0
              ? '准备中…'
              : `第 ${currentStep + 1} / ${total} 步`}
        </p>
        <span className="text-[11px] tabular-nums text-amber-700/80">{percent}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/70">
        <div
          className="h-full bg-amber-500 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
          data-testid="auto-test-plan-progress"
        />
      </div>

      {/* 中部：5 步列表 */}
      <ul className="mt-3 space-y-1.5" data-testid="auto-test-plan-steps">
        {plan.map((step, idx) => {
          const status = statusOf(idx);
          const dot =
            status === 'done'
              ? 'bg-emerald-500'
              : status === 'active'
                ? 'bg-amber-500 animate-pulse'
                : 'bg-slate-300';
          const label =
            status === 'done' ? '已完成' : status === 'active' ? '进行中' : '待执行';
          const rowClass =
            status === 'active'
              ? 'border-amber-300 bg-white/80'
              : 'border-slate-200/70 bg-white/40';
          return (
            <li
              key={step.key}
              data-step={step.key}
              data-status={status}
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${rowClass}`}
            >
              <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-700">
                  <span className="mr-1 text-[10px] text-slate-400">{idx + 1}.</span>
                  {step.title}
                  <span
                    className={`ml-1.5 text-[10px] ${
                      status === 'active'
                        ? 'text-amber-700'
                        : status === 'done'
                          ? 'text-emerald-700'
                          : 'text-slate-400'
                    }`}
                  >
                    {label}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{step.description}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* 底部：耗时 / 友好提示 / 最近工具调用 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-amber-700/90">
        <span className="tabular-nums" data-testid="auto-test-elapsed">
          ⏱ 已用时 {formatDuration(elapsedMs)}
        </span>
        {!finished && !isOver && remainingMs > 0 && (
          <span className="tabular-nums" data-testid="auto-test-remaining">
            ⏱ 预计还需 {formatDuration(remainingMs)}
          </span>
        )}
        {!finished && isOver && (
          <span
            className="tabular-nums rounded bg-amber-200/60 px-1.5 py-0.5 text-amber-800"
            data-testid="auto-test-overtime"
            title={`初始预估 ${formatDuration(expectedDurationMs)}，实际已用 ${formatDuration(
              elapsedMs,
            )}`}
          >
            ⏱ 已超出预估 {formatDuration(overtimeMs)}
          </span>
        )}
        {finished && typeof totalDurationMs === 'number' && (
          <span
            className="tabular-nums rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700"
            data-testid="auto-test-total"
          >
            ✅ 本次总耗时 {formatDuration(totalDurationMs)}
          </span>
        )}
      </div>

      {!finished && !isOver && (
        <p className="mt-1.5 text-[11px] text-amber-700/70" data-testid="auto-test-friendly-tip">
          💡 不用一直盯着，约 {formatDuration(remainingMs)} 后会自动出报告；
          关掉窗口或退出也行，再点测试会从头来一次（计划仍会显示）。
        </p>
      )}

      {!finished && isOver && (
        <p
          className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-amber-700/80"
          data-testid="auto-test-friendly-tip-overtime"
        >
          <span>
            💡 比预估更久了，仍在执行工具调用中；不急着打断，等模型给出最终报告即可。
          </span>
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              data-testid="auto-test-overtime-stop"
              className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100"
              title="如已卡住可立即中断，停止后将进入自动重试倒计时"
            >
              ⏹ 中断测试
            </button>
          )}
        </p>
      )}

      {/* 跑马灯：与上次会话加的全局动效一致，避免用户误判卡死 */}
      {!finished && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Marquee
              variant="amber"
              speed="slow"
              text="🧪 自动测试进行中"
              height="tight"
              dataTestid="auto-test-plan-marquee"
            />
          </div>
          {/* v3.2.1 P1-13：让停止按钮始终可见，不依赖 overtime——用户随时可以放弃这一轮测试。
              之前只在 isOver=true 时才渲染，用户正常跑 30 分钟时拿不到入口。 */}
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              data-testid="auto-test-stop"
              className="shrink-0 inline-flex items-center gap-1 rounded border border-amber-300 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100"
              title="放弃本轮测试，停止后将进入自动重试倒计时"
              aria-label="停止测试"
            >
              ⏹ 停止
            </button>
          )}
        </div>
      )}

      {/* 最近工具调用（如有），单行 mono 字体 */}
      {latestProgress && (
        <p
          className="mt-1.5 truncate rounded bg-white/70 px-2 py-1 font-mono text-[11px] text-slate-600"
          data-testid="auto-test-latest-tool"
          title={latestProgress}
        >
          🔧 {latestProgress}
        </p>
      )}
    </div>
  );
}