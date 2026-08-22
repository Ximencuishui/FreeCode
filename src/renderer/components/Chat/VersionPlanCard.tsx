import { useEffect, useState } from 'react';
import type { VersionPlan, ProjectStatus } from '@shared/types/project';

interface VersionPlanCardProps {
  plan: VersionPlan | null;
  /** 需求卡片中的全部核心功能（用于勾选调整） */
  coreFeatures: string[];
  status: ProjectStatus | null;
  onConfirm: (plan: VersionPlan) => void;
}

/**
 * 版本分段计划卡片（写代码前的 MVP 切分）。
 * AI 提议哪些功能进 V1（最小可用版本），用户可勾选调整；确认后只开发 V1。
 */
export default function VersionPlanCard({
  plan,
  coreFeatures,
  status,
  onConfirm,
}: VersionPlanCardProps) {
  // V1 包含的功能集合（默认取 AI 提议）
  const [v1Features, setV1Features] = useState<string[]>([]);

  useEffect(() => {
    if (plan) {
      setV1Features(plan.versions[0]?.features ?? []);
    }
  }, [plan]);

  const toggle = (feature: string) => {
    setV1Features((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature],
    );
  };

  const handleConfirm = () => {
    if (!plan || v1Features.length === 0) return;
    const v2Features = coreFeatures.filter((f) => !v1Features.includes(f));
    const v2Base = plan.versions.find((v) => v.label !== plan.versions[0].label);
    const versions = [
      {
        label: plan.versions[0].label,
        description: plan.versions[0].description,
        features: v1Features,
      },
    ];
    if (v2Features.length > 0) {
      versions.push({
        label: v2Base?.label ?? 'V2',
        description: v2Base?.description ?? '完善版本：在 V1 基础上补齐其余功能',
        features: v2Features,
      });
    }
    onConfirm({ versions });
  };

  const v2Features = coreFeatures.filter((f) => !v1Features.includes(f));
  const v1Label = plan?.versions[0]?.label ?? 'V1';

  return (
    <div
      data-testid="version-plan-card"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">🗺️ 版本分段计划</h3>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">先做 MVP</span>
      </div>

      {!plan ? (
        <div className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
          ⏳ 正在为您规划版本分段…
          <br />
          <span className="mt-1 block">
            好的软件是一步步做出来的，先帮您挑出最重要的功能
          </span>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            一口吃不成胖子：先做出最小可用版本（{v1Label}），用起来再慢慢完善。勾选您想放进{' '}
            {v1Label} 的功能：
          </p>

          <div className="space-y-1.5">
            {coreFeatures.map((feature) => {
              const checked = v1Features.includes(feature);
              return (
                <label
                  key={feature}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    checked
                      ? 'border-brand/40 bg-brand/5 text-slate-700'
                      : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(feature)}
                    disabled={status !== 'planned'}
                    className="h-3.5 w-3.5 accent-[#4A90D9]"
                  />
                  <span className="flex-1">{feature}</span>
                  {checked ? (
                    <span className="text-[10px] text-brand">{v1Label}</span>
                  ) : (
                    <span className="text-[10px] text-slate-300">以后再做</span>
                  )}
                </label>
              );
            })}
          </div>

          {v2Features.length > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              其余 {v2Features.length} 个功能将在后续版本完善，不会丢失。
            </p>
          )}

          {status === 'planned' && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={v1Features.length === 0}
              className="mt-4 w-full rounded-lg bg-brand py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {v1Features.length === 0 ? '请至少选择 1 个功能' : `确认计划，开始开发 ${v1Label}`}
            </button>
          )}
          {status === 'developing' && (
            <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-center text-xs text-blue-600">
              🚀 计划已确认，正在开发 {v1Label}（最小可用版本）…
            </div>
          )}
        </>
      )}
    </div>
  );
}
