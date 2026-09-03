import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../Chat/autoTestProgress';

interface InterruptBannerProps {
  /**
   * v0.1.02 P0-3：retryAt 可为 null，表示「已达重试上限，请手动重试」。
   * 此时不启动自动倒计时，按钮文案也不显示倒计时。
   */
  banner: { reason: string; retryAt: number | null };
  /**
   * v3.2.1 P1-6：当前已连续失败的次数（与 autoTestRetryCount 同源），用于在横幅上
   * 直观展示「第 N/M 次重试」进度，让用户清楚知道还要等多久/还要重试几次。
   * 不传则退化为无进度展示（兼容旧测试场景）。
   */
  retryIndex?: number;
  /** 总自动重试次数上限（默认 3，与 P0-3 一致） */
  retryTotal?: number;
  /** 立即重试按钮回调（用户点击「立即重试/手动重试」按钮，计为用户主动重置） */
  onRetry: () => void;
  /**
   * v0.1.02 P3-AUDIT：自动倒计时到点触发的回调（与用户手动点击分离）。
   * 区分原因：用户主动重试应清零失败计数（新一轮 3 次机会），但自动倒计时
   * 是失败 → 退避 → 重试的内循环，若也清零，P0-3 的 3 次上限永远到不了。
   * 不传则自动倒计时到点等同于 onRetry（保留旧行为兼容测试场景）。
   */
  onAutoRetry?: () => void;
  onCancel: () => void;
}

/**
 * 自动测试被中断时的 amber 横幅：
 * - retryAt 有值时：每秒倒计时，到点自动 onRetry() 触发 auto-test 重跑（指数退避）
 * - retryAt=null 时：v0.1.02 P0-3 已达重试上限，仅展示「立即重试 / 取消」按钮，无倒计时
 * - 用户点「立即重试」→ onRetry()；点「取消」→ onCancel()（清掉 banner）
 *
 * 设计要点：
 * - 用 useEffect + ref 追踪最新 onRetry，避免父组件传入新引用导致 stale closure
 * - 显示前先检查 banner 仍存在（防止 stale timer 在 banner 已清掉的情况下误触发）
 */
export default function InterruptBanner({
  banner,
  retryIndex,
  retryTotal = 3,
  onRetry,
  onAutoRetry,
  onCancel,
}: InterruptBannerProps) {
  // 注：hooks 必须无条件调用，避免 rules-of-hooks 报错。
  // banner 已清掉的情况下，副作用 effect 通过 if (!banner) return 提前退出；渲染本身交给父组件条件挂载。

  // 每秒刷新倒计时；卸载或 banner 变化时清掉旧 interval
  const [, setTick] = useState(0);
  // v0.1.02 P3-AUDIT：自动倒计时 onAutoRetry 与手动 onRetry 分离引用，
  // 避免父组件每次渲染把 onRetry 当成新函数导致 timer 重置。
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  const onAutoRetryRef = useRef(onAutoRetry);
  onAutoRetryRef.current = onAutoRetry;
  const bannerRef = useRef(banner);
  bannerRef.current = banner;

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // v0.1.02 P0-3：仅当 retryAt 有值时才启动自动倒计时；retryAt=null 表示已达上限，不自动重试
  // v0.1.02 P3-AUDIT：到点优先调 onAutoRetry（与手动 onRetry 分离，保留失败计数 → 3 次上限生效）
  useEffect(() => {
    if (!banner || banner.retryAt === null) return;
    const delay = Math.max(0, banner.retryAt - Date.now());
    const id = window.setTimeout(() => {
      // 触发前再次校验 banner 仍存在（防止 stale timer）
      if (bannerRef.current) {
        if (onAutoRetryRef.current) onAutoRetryRef.current();
        else onRetryRef.current();
      }
    }, delay);
    return () => window.clearTimeout(id);
  }, [banner]);

  if (!banner) return null;

  // v0.1.02 P0-3：retryAt=null 时不显示倒计时，按钮文案改为「手动重试」
  const retryAt = banner.retryAt;
  const showCountdown = retryAt !== null;
  const remainingMs = showCountdown ? Math.max(0, retryAt - Date.now()) : 0;
  const retryLabel = showCountdown ? '立即重试' : '手动重试';
  return (
    <div
      data-testid="fc-assistant-interrupt-banner"
      // v3.2.1 P3-2：明示 aria-live="assertive" 让屏幕阅读器立刻朗读
      // 自动测试失败 / 重试倒计时变化等关键状态（role="alert" 已隐含 assertive，
      // 显式声明是为辅助技术忽略隐式语义时兜底）；aria-atomic=false 让屏幕阅读器
      // 只读变更部分，避免每秒钟倒计时刷一次就重读整段。
      className="mb-2.5 rounded-xl border border-amber-400 bg-amber-100/80 px-3 py-2 text-xs text-amber-900 animate-fadeIn"
      role="alert"
      aria-live="assertive"
      aria-atomic="false"
    >
      {/* v3.2.1 P1-6：在标题行展示「第 N/M 次重试」进度，让用户知道还要等多久。
          不传 retryIndex 时退化为旧文案（兼容旧测试场景）。 */}
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">
          ⚠️ 测试被中断
          {typeof retryIndex === 'number' && retryIndex > 0 && (
            <span
              className="ml-1.5 inline-flex items-center rounded-full bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-900"
              data-testid="fc-assistant-interrupt-retry-progress"
            >
              第 {retryIndex}/{retryTotal} 次重试
            </span>
          )}
          {!showCountdown && '（已达自动重试上限）'}
        </p>
      </div>
      <p className="mt-0.5 text-amber-800/90">{banner.reason}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onRetry}
          className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-600"
          data-testid="fc-assistant-interrupt-retry"
        >
          {retryLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-200"
          data-testid="fc-assistant-interrupt-cancel"
        >
          取消
        </button>
        {showCountdown && (
          <span
            className="ml-auto tabular-nums text-[11px] text-amber-700/80"
            data-testid="fc-assistant-interrupt-countdown"
          >
            {formatDuration(remainingMs)} 后自动重试
          </span>
        )}
      </div>
    </div>
  );
}