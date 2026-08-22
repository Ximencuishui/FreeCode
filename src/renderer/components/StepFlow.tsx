import type { ProjectStatus } from '@shared/types/project';

interface StepFlowProps {
  status: ProjectStatus | null;
  onGoChat: () => void;
  onGoPreview: () => void;
  onGoExport: () => void;
}

/** 主流程步骤条：创建项目 → 方案探讨 → 版本分段 → 生成代码 → 预览调整 → 导出 */
const STEPS = [
  { key: 'create', label: '创建项目' },
  { key: 'discuss', label: '方案探讨' },
  { key: 'plan', label: '版本分段' },
  { key: 'code', label: '生成代码' },
  { key: 'preview', label: '预览调整' },
  { key: 'export', label: '导出' },
] as const;

/** 各状态对应的当前步骤下标（draft=方案探讨，planned=版本分段，developing=生成代码…） */
function currentIndex(status: ProjectStatus | null): number {
  switch (status) {
    case 'draft':
      return 1;
    case 'planned':
      return 2;
    case 'developing':
      return 3;
    case 'ready':
      return 4;
    case 'exported':
      return 5;
    default:
      return 0;
  }
}

export default function StepFlow({ status, onGoChat, onGoPreview, onGoExport }: StepFlowProps) {
  const active = currentIndex(status);

  const handleClick = (index: number) => {
    // 步骤 0-3（创建/探讨/分段/写代码）都在对话中完成；4 去预览；5 打开导出
    if (index <= 3) onGoChat();
    else if (index === 4) onGoPreview();
    else onGoExport();
  };

  return (
    <div className="flex shrink-0 items-center justify-center gap-1 border-b border-slate-200 bg-slate-50/60 px-4 py-2">
      {STEPS.map((step, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <div key={step.key} className="flex items-center">
            {i > 0 && (
              <span
                className={`mx-1.5 h-px w-6 ${done || current ? 'bg-brand' : 'bg-slate-200'}`}
              />
            )}
            <button
              type="button"
              onClick={() => handleClick(i)}
              title={step.label}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
                current
                  ? 'bg-brand/10 font-medium text-brand'
                  : done
                    ? 'text-slate-500 hover:bg-slate-100'
                    : 'text-slate-400'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  current
                    ? 'bg-brand text-white'
                    : done
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'bg-slate-200 text-slate-400'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              {step.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
