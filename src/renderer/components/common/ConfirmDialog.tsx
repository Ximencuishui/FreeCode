import { useEffect, useRef } from 'react';

/**
 * 通用确认弹窗（v3.2.1 验收 P1-1 修复）。
 * 替代 `window.confirm`，提供品牌化样式、主题适配、键盘可达性与 ARIA 标注。
 *
 * 设计要点：
 * - 复用项目既有的 Modal 风格（与 ApiKeyModal / SaveLocationDialog 一致的遮罩 + 圆角面板 + 主题色按钮）。
 * - ESC / 点击遮罩 = 取消（danger 变体下需显式 disable 遮罩关闭，避免误触丢数据）。
 * - 焦点默认落在"取消"按钮上，避免误按回车就确认（参考桌面应用防误操作惯例）。
 * - 主按钮 / 取消按钮文案可定制；danger 变体下主按钮改红色 + 强调。
 */
export type ConfirmTone = 'default' | 'danger';

interface ConfirmDialogProps {
  open: boolean;
  /** 标题（短，一行） */
  title: string;
  /** 正文（可换行） */
  description?: React.ReactNode;
  /** 确认按钮文案 */
  confirmLabel?: string;
  /** 取消按钮文案 */
  cancelLabel?: string;
  /** 危险操作：主按钮变红 + 遮罩点击禁用 */
  tone?: ConfirmTone;
  /** 确认按钮 busy 态文案 */
  confirming?: boolean;
  /** 取消回调 */
  onCancel: () => void;
  /** 确认回调 */
  onConfirm: () => void;
}

const TONE_STYLES: Record<
  ConfirmTone,
  { confirm: string; ringFocus: string; iconBg: string; iconColor: string; icon: string }
> = {
  default: {
    confirm:
      'bg-brand text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50',
    ringFocus: 'focus-visible:ring-brand',
    iconBg: 'bg-brand/10',
    iconColor: 'text-brand',
    icon: '🤔',
  },
  danger: {
    confirm:
      'bg-red-600 text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50',
    ringFocus: 'focus-visible:ring-red-500',
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    icon: '⚠️',
  },
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'default',
  confirming = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // v3.2.2 P1-15：记录弹窗打开前的 activeElement，关闭时把焦点还回去。
  // 否则关闭后焦点掉回 <body>，键盘用户得按 Tab 一路找回去，体验割裂。
  // 仅在 open 从 false → true 时记录，避免误把弹窗内元素当 trigger。
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const styles = TONE_STYLES[tone];

  // 打开时记录 trigger + 聚焦到"取消"按钮（防误操作）
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      // 只在初次打开（false → true）时记录。open=true 持续期间不更新 trigger，
      // 避免弹窗内按钮点击导致 activeElement 变化后，下次关闭还焦点到错误位置。
      triggerRef.current = document.activeElement as HTMLElement | null;
    }
    if (!open && wasOpenRef.current) {
      // 关闭时还焦点回 trigger
      triggerRef.current?.focus();
      triggerRef.current = null;
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  // ESC 取消
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirming) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, confirming, onCancel]);

  // 回车 = 触发当前 focus 的按钮（默认取消）；保持原生按钮语义
  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? 'confirm-dialog-desc' : undefined}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        // danger 变体禁止点击遮罩关闭，避免误触丢数据
        if (tone === 'danger' || confirming) return;
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 p-5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ${styles.iconBg}`}
            aria-hidden
          >
            {styles.icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="confirm-dialog-title"
              className="text-sm font-semibold leading-snug text-slate-800"
            >
              {title}
            </h2>
            {description && (
              <div
                id="confirm-dialog-desc"
                className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-slate-500"
              >
                {description}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className={`rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${styles.ringFocus}`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 ${styles.confirm} ${styles.ringFocus}`}
          >
            {confirming ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
