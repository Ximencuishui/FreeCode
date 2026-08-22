import type { RequirementSummary, ProjectStatus } from '@shared/types/project';

interface RequirementCardProps {
  requirements: RequirementSummary;
  status?: ProjectStatus | null;
  onConfirm: () => void;
}

/** 需求卡片（前端设计说明书 3.4） */
export default function RequirementCard({ requirements, status, onConfirm }: RequirementCardProps) {
  const confirmed: boolean =
    requirements.confirmed ||
    status === 'planned' ||
    status === 'developing' ||
    status === 'ready' ||
    status === 'exported';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">📋 需求概要</h3>
        {confirmed ? (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600">✅ 已确认</span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600">待确认</span>
        )}
      </div>

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-slate-400">一句话目标</dt>
          <dd className="text-slate-700">{requirements.goal || '（待补充）'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">目标用户</dt>
          <dd className="text-slate-700">{requirements.targetUsers || '（待补充）'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">核心功能</dt>
          <dd className="text-slate-700">
            {requirements.coreFeatures.length > 0 ? (
              <ul className="list-inside list-disc space-y-0.5">
                {requirements.coreFeatures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              '（待补充）'
            )}
          </dd>
        </div>
      </dl>

      {!confirmed && requirements.goal && (
        <button
          type="button"
          onClick={onConfirm}
          className="mt-4 w-full rounded-lg bg-brand py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
        >
          确认需求，规划版本
        </button>
      )}

      {status === 'planned' && (
        <div className="mt-3 text-center text-xs text-slate-400">
          正在规划版本分段，先做最小可用版本…
        </div>
      )}
      {status === 'ready' && (
        <div className="mt-3 text-center text-xs text-green-600">✅ 应用已就绪，点击左侧「预览」查看</div>
      )}
    </div>
  );
}
