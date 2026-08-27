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

  // 自动测试进行中：把整张引导卡切换为"测试中"实时进度态
  if (autoTestRunning) {
    return (
      <div className="flex justify-start">
        <div className="max-w-full rounded-xl rounded-bl-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
          <p className="font-medium text-amber-800">📌 欢迎回来，{guide.projectName}</p>
          <p className="mt-1 text-amber-700/90">项目进度：{guide.phaseText}</p>
          <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-amber-300 bg-white/70 px-3 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <span className="text-sm font-medium text-amber-800">🧪 测试进行中</span>
          </div>
          {autoTestLatestProgress && (
            <p
              className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded border border-amber-200 bg-white/60 px-2.5 py-1.5 text-xs text-slate-600"
              data-testid="auto-test-progress"
            >
              {autoTestLatestProgress}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-amber-700/70">
            测试报告会作为新消息推送到右侧对话窗口，完成后这里会自动切回。
          </p>
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