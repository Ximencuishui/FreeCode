import { useState } from 'react';
import type { ResumeGuide, ResumeAction } from '../../store/chat';

interface ResumeCardProps {
  guide: ResumeGuide;
  onAction: (action: ResumeAction) => void;
  /** 一键自动测试进行中：展示"测试中"实时进度；非测试时为 false */
  autoTestRunning?: boolean;
  /** 自动测试最近一条进度文本（工具调用 / 思考） */
  autoTestLatestProgress?: string | null;
}

/** 重新进入中途项目的进度引导卡（AI 助理汇报进度 + 下一步按钮；黄色警示底，支持多动作） */
export default function ResumeCard({
  guide,
  onAction,
  autoTestRunning = false,
  // 保留入参以保持接口兼容；测试进度/跑马灯已由 AutoTestPlanCard 承担，本组件不再渲染。
  // 实际写入 data-* 属性供 e2e 测试断言 + 调试面板读最新进度，避免 noUnusedParameters 误报。
  autoTestLatestProgress = null,
}: ResumeCardProps) {
  const [pending, setPending] = useState<ResumeAction | null>(null);

  const act = (action: ResumeAction) => {
    setPending(action);
    onAction(action);
    // 短暂禁用防连点（动作若触发后台任务，卡片会自动切换状态）
    setTimeout(() => setPending(null), 1500);
  };

  const buttons = guide.actions && guide.actions.length > 0 ? guide.actions : null;

  // 自动测试进行中：测试计划详情/跑马灯/计时由 ChatContainer 中的 AutoTestPlanCard 承担
  // v3.2.1 P2-1：这里加一个"mini 进度"行，显示最近一条工具调用文本，让用户在对话流上方
  // 就能看到 AI 在做什么，不需要展开下方大卡片。
  if (autoTestRunning) {
    const latest = autoTestLatestProgress?.trim();
    return (
      <div className="flex justify-start">
        <div
          className="max-w-full rounded-xl rounded-bl-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-slate-700"
          data-latest-progress={autoTestLatestProgress ?? ''}
        >
          <p className="font-medium text-amber-800">📌 欢迎回来，{guide.projectName}</p>
          <p className="mt-1 text-amber-700/90">项目进度：{guide.phaseText}</p>
          <p
            className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-amber-700/80"
            data-testid="auto-test-progress-hint"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            <span>自动测试进行中，详细进度见下方计划卡</span>
          </p>
          {/* v3.2.1 P2-1：mini 进度条——把最近一条工具调用文本作为"还在做什么"的实时反馈。
              长文本用 truncate + title 避免撑高卡片；空文本时显示占位说明，避免 UI 抖动。 */}
          {latest ? (
            <div
              className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-700/70"
              data-testid="auto-test-mini-progress"
              title={latest}
            >
              <span aria-hidden="true">▸</span>
              <span className="truncate">{latest}</span>
            </div>
          ) : (
            <div
              className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-700/60"
              data-testid="auto-test-mini-progress-empty"
            >
              <span aria-hidden="true">▸</span>
              <span className="italic">等待工具调用…</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-full rounded-xl rounded-bl-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
        <p className="font-medium text-amber-800">📌 欢迎回来，{guide.projectName}</p>
        <p className="mt-1 text-amber-700/90">
          {guide.action === 'none' ? '目前进度：' : '项目进度：'}
          {guide.phaseText}
        </p>
        {buttons ? (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {buttons.map((b) => (
              <button
                key={b.action}
                type="button"
                disabled={pending !== null}
                onClick={() => act(b.action)}
                className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending === b.action ? '处理中…' : b.label}
              </button>
            ))}
          </div>
        ) : (
          guide.action !== 'none' && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => act(guide.action)}
              className="mt-2.5 w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending === guide.action ? '处理中…' : `${guide.actionText} →`}
            </button>
          )
        )}
      </div>
    </div>
  );
}