import type { AutoTestPlanSummary } from '@shared/types/project';
import { formatDuration } from './autoTestProgress';

interface AutoTestSummaryCardProps {
  summary: AutoTestPlanSummary;
  dataTestid?: string;
}

/**
 * 自动测试计划完成态摘要：作为系统消息渲染到聊天历史中。
 * 显示每一步实际耗时 + 总耗时，便于用户回顾本次测试周期。
 */
export default function AutoTestSummaryCard({
  summary,
  dataTestid,
}: AutoTestSummaryCardProps) {
  const total = summary.stepDurationsMs.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...summary.stepDurationsMs);
  const finishedAt = new Date(summary.finishedAt);
  const finishedAtText = finishedAt.toLocaleString('zh-CN', { hour12: false });

  return (
    <div
      data-testid={dataTestid ?? 'auto-test-summary-card'}
      className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-xs leading-relaxed text-slate-600"
    >
      <p className="font-medium text-emerald-700">📊 测试计划耗时摘要</p>
      <ul className="mt-1.5 space-y-1" data-testid="auto-test-summary-rows">
        {summary.steps.map((step, idx) => {
          const ms = summary.stepDurationsMs[idx] ?? 0;
          const barPct = Math.round((ms / max) * 100);
          return (
            <li key={step.key} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-slate-500">{step.title}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-emerald-100">
                <span
                  className="block h-full bg-emerald-500"
                  style={{ width: `${barPct}%` }}
                />
              </span>
              <span
                className="w-14 shrink-0 text-right tabular-nums text-slate-600"
                data-step-duration={step.key}
              >
                {formatDuration(ms)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-emerald-200/70 pt-1.5 text-[11px]">
        <span className="text-emerald-700/80">完成于 {finishedAtText}</span>
        <span
          className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 tabular-nums"
          data-testid="auto-test-summary-total"
        >
          总耗时 {formatDuration(total)}
        </span>
      </div>
    </div>
  );
}