import { useEffect, useRef } from 'react';
import { useUiStore, type NotificationItem } from '../../store/ui';

/**
 * 全局通知浮层宿主（P0 建议 3）。
 *
 * 在 App.tsx 顶层挂载一次，订阅 useUiStore.notifications 并按入队顺序渲染。
 * 解决原「AI 已经判断可以部署」无前端反馈的体验断点：
 *   - 主进程把 projectStatus 推到 'ready' → useDeploymentReadyToast（App.tsx）
 *     调 pushNotification → 这里自动渲染 → 用户立即看到「可以部署了」
 *
 * 设计要点：
 *   - 自动消失用 setTimeout + React effect：组件卸载时清理 timeout，避免
 *     setState on unmounted 警告；同 id 被 dismiss 时也能清掉 timeout。
 *   - 点 action.onClick 后自动 dismiss（避免「点了按钮通知还在」的认知负担）。
 *   - 颜色：success = 翠绿，info = 品牌蓝，warning = 琥珀；与 DeployView 已有的
 *     emerald / blue / amber 语义色保持一致（v0.1.02 P2-6）。
 *   - 固定右下角（bottom-right-4 right-4），z-50（与 DeploymentAssistant 同级
 *     但位置不同，不冲突）；多条通知纵向堆叠，间距 8px。
 */

const KIND_STYLES: Record<
  NotificationItem['kind'],
  { ring: string; iconBg: string; iconColor: string; defaultIcon: string }
> = {
  success: {
    ring: 'ring-emerald-200',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-700',
    defaultIcon: '✅',
  },
  info: {
    ring: 'ring-brand/30',
    iconBg: 'bg-brand/10',
    iconColor: 'text-brand',
    defaultIcon: 'ℹ️',
  },
  warning: {
    ring: 'ring-amber-200',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
    defaultIcon: '⚠️',
  },
};

interface NotificationCardProps {
  item: NotificationItem;
}

function NotificationCard({ item }: NotificationCardProps) {
  const dismiss = useUiStore((s) => s.dismissNotification);
  const styles = KIND_STYLES[item.kind];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 自动消失：autoDismissMs > 0 时挂载后到点调 dismiss
  useEffect(() => {
    if (!item.autoDismissMs || item.autoDismissMs <= 0) return undefined;
    timerRef.current = setTimeout(() => {
      dismiss(item.id);
    }, item.autoDismissMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [item.id, item.autoDismissMs, dismiss]);

  const handleActionClick = () => {
    // 先 dismiss 再触发 onClick：避免「通知还在但页面已经跳转」导致用户疑惑
    dismiss(item.id);
    item.action?.onClick();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="fc-notification"
      data-notification-id={item.id}
      className={`pointer-events-auto flex w-80 items-start gap-3 rounded-xl bg-white p-3 shadow-lg ring-1 ${styles.ring}`}
    >
      <div
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base ${styles.iconBg} ${styles.iconColor}`}
      >
        {item.icon ?? styles.defaultIcon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-800">{item.message}</div>
        {item.action && (
          <button
            type="button"
            onClick={handleActionClick}
            data-testid="fc-notification-action"
            className="mt-1.5 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-hover"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="关闭通知"
        className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        ✕
      </button>
    </div>
  );
}

export default function NotificationHost() {
  const notifications = useUiStore((s) => s.notifications);

  if (notifications.length === 0) return null;

  return (
    <div
      aria-label="通知"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {notifications.map((n) => (
        <NotificationCard key={n.id} item={n} />
      ))}
    </div>
  );
}
