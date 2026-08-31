import { useEffect, useState } from 'react';
import type { AutoTestPlanStep } from '@shared/types/project';
import Marquee from '../Marquee';
import {
  estimateRemainingMs,
  formatDuration,
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
}: AutoTestPlanCardProps) {
  const total = plan.length;
  // 让「已用时」/「预计还需」每秒钟刷新一次
  const [, setTick] = useState(0);
  useEffect(() => {
    if (finished) return undefined;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [finished]);

  const now = Date.now();
  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const remainingMs = finished
    ? 0
    : estimateRemainingMs(expectedDurationMs, startedAt, now, finished);
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
      className="rounded-xl border border-amber-300 bg-amber-50/70 px-4 py-3 text-sm leading-relaxed text-slate-700"
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
        {!finished && (
          <span className="tabular-nums" data-testid="auto-test-remaining">
            ⏱ 预计还需 {formatDuration(remainingMs)}
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

      {!finished && (
        <p className="mt-1.5 text-[11px] text-amber-700/70" data-testid="auto-test-friendly-tip">
          💡 不用一直盯着，约 {formatDuration(remainingMs)} 后会自动出报告；
          关掉窗口或退出也行，再点测试会从头来一次（计划仍会显示）。
        </p>
      )}

      {/* 跑马灯：与上次会话加的全局动效一致，避免用户误判卡死 */}
      {!finished && (
        <div className="mt-2">
          <Marquee
            variant="amber"
            speed="slow"
            text="🧪 自动测试进行中"
            height="tight"
            dataTestid="auto-test-plan-marquee"
          />
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