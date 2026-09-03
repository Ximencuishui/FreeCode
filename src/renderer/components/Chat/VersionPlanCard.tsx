import { useEffect, useRef, useState } from 'react';
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
  // v0.1.02 P3-10：版本分段计划生成超过 10 秒仍未到位时，从「安静等待」切到「显式说明 +
  // 手动刷新兜底」，避免用户盯着"⏳ 正在为您规划版本分段…"一直不知道发生了什么。
  const [waitingSec, setWaitingSec] = useState(0);
  const [pendingRefresh, setPendingRefresh] = useState(false);
  // v0.1.02 P3-AUDIT：把 handleManualRefresh 的 setTimeout 存到 ref，组件卸载/计划到达
  // 时清掉。否则切换项目 2s 内点刷新会触发 "state update on unmounted component" 警告。
  const pendingRefreshTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pendingRefreshTimerRef.current !== null) {
        window.clearTimeout(pendingRefreshTimerRef.current);
      }
    },
    [],
  );
  // 模拟进度条用：每秒 +1，达到 STUCK_THRESHOLD_SEC 后切到兜底提示。
  const STUCK_THRESHOLD_SEC = 10;
  const MAX_VISIBLE_SEC = 60; // 超过 60s 显示"已超过 1 分钟…"

  useEffect(() => {
    if (plan) {
      // 计划已生成：重置计时器，停止"等待中"的进度反馈。
      setWaitingSec(0);
      setPendingRefresh(false);
      return undefined;
    }
    if (status !== 'planned') {
      // 仅在 planned 阶段才展示"等待计划"——draft / developing 时根本不应该渲染此卡。
      setWaitingSec(0);
      return undefined;
    }
    // 计划生成中：每秒自增一次 waitingSec
    const timer = window.setInterval(() => setWaitingSec((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [plan, status]);

  useEffect(() => {
    if (plan) {
      setV1Features(plan.versions[0]?.features ?? []);
    }
  }, [plan]);

  const handleManualRefresh = () => {
    setPendingRefresh(true);
    // 不直接调 IPC——父组件轮询已经在跑了，这里只是给用户一个"我尝试过"的反馈。
    // 2s 后自动复位 pendingRefresh，避免按钮卡在"刷新中…"状态。
    // v0.1.02 P3-AUDIT：用 ref 跟踪 timer，连续点击时清掉上一个 timer，避免 race condition。
    if (pendingRefreshTimerRef.current !== null) {
      window.clearTimeout(pendingRefreshTimerRef.current);
    }
    pendingRefreshTimerRef.current = window.setTimeout(() => {
      setPendingRefresh(false);
      pendingRefreshTimerRef.current = null;
    }, 2000);
  };

  const toggle = (feature: string) => {
    setV1Features((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature],
    );
  };

  const handleConfirm = () => {
    if (!plan || v1Features.length === 0) return;
    const v2PlusOriginals = plan.versions.slice(1);
    // 找出被用户从 V1 移出去的功能（不在 v1Features 里、但原本在 V1 里）。
    // v0.1.02 P2-3：不再硬编码 'V2' —— 保留 V2+ 段原本的 label / description，只把
    // V1 移出去的功能追加到「最后一段」的特征列表之后。这样 V1/V2/V3 的三段计划
    // 不会因为去掉一个 V1 功能就被合并错乱。
    const v1OriginalFeatures = plan.versions[0]?.features ?? [];
    const movedFromV1 = v1OriginalFeatures.filter((f) => !v1Features.includes(f));
    const lastIndex = v2PlusOriginals.length - 1;
    const v2Plus: typeof v2PlusOriginals =
      lastIndex >= 0
        ? v2PlusOriginals.map((v, idx) =>
            idx === lastIndex ? { ...v, features: [...v.features, ...movedFromV1] } : v,
          )
        : // 原本就只有 V1 一段：从 V1 移出去的功能单独生成一段 V2，避免静默丢弃
          movedFromV1.length > 0
          ? [
              {
                label: 'V2',
                description: '完善版本：在 V1 基础上补齐其余功能',
                features: movedFromV1,
              },
            ]
          : [];
    const versions = [
      {
        label: plan.versions[0].label,
        description: plan.versions[0].description,
        features: v1Features,
      },
      ...v2Plus,
    ];
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
        <div className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          {waitingSec < STUCK_THRESHOLD_SEC ? (
            // 前 10 秒：安静等待 + 进度感（数字缓慢增长）
            <>
              <div
                className="mx-auto mb-2 h-1.5 w-32 overflow-hidden rounded-full bg-slate-200"
                data-testid="version-plan-progress-track"
              >
                <div
                  className="h-full bg-brand/60 transition-all duration-1000 ease-linear"
                  data-testid="version-plan-progress"
                  style={{ width: `${Math.min(100, (waitingSec / STUCK_THRESHOLD_SEC) * 100)}%` }}
                />
              </div>
              ⏳ 正在为您规划版本分段… ({waitingSec}s)
              <br />
              <span className="mt-1 block text-slate-400">
                好的软件是一步步做出来的，先帮您挑出最重要的功能
              </span>
            </>
          ) : waitingSec < MAX_VISIBLE_SEC ? (
            // 10s-60s：兜底提示 + 手动刷新按钮
            <>
              <div className="mb-1 text-amber-700">
                ⏳ 已等待 {waitingSec} 秒，AI 仍在仔细权衡
              </div>
              <div className="mt-1 text-slate-400">
                通常 10-30 秒内即可完成；若一直停留，可点击下方按钮手动检查
              </div>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={pendingRefresh}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
              >
                {pendingRefresh ? '刷新中…' : '🔄 刷新检查'}
              </button>
            </>
          ) : (
            // 60s+：长期未完成，提示去聊天窗口催一下或检查网络
            <>
              <div className="mb-1 text-red-700">
                ⚠️ 已等待超过 1 分钟，可能网络或模型侧拥堵
              </div>
              <div className="mt-1 text-slate-400">
                可去右侧对话窗口说一声"分段计划好了吗"催一下，或继续提问引导 AI
              </div>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={pendingRefresh}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
              >
                {pendingRefresh ? '刷新中…' : '🔄 再检查一次'}
              </button>
            </>
          )}
        </div>
      ) : plan.versions.length === 0 ? (
        // v3.2.1 P3-4b：AI 返回了空版本分段计划（极少数情况，比如上游模型超时被截断）。
        // 不再让用户盯着空列表，而是给出明确文案 + 主动重规划入口。
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-4 text-center text-xs text-amber-800"
          data-testid="version-plan-empty"
        >
          <div className="mb-1 font-medium">⚠️ AI 未给出明确的版本分段</div>
          <div className="mt-1 text-amber-700/90">
            通常是上游模型响应被截断，可点击下方按钮让 AI 重新规划一次。
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={pendingRefresh}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1 text-xs text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
          >
            {pendingRefresh ? '重规划中…' : '🔄 重新规划'}
          </button>
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
