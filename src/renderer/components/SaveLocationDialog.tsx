import { useCallback, useEffect, useState } from 'react';

interface SaveLocationDialogProps {
  /** 待创建的项目名称 */
  projectName: string;
  /** 是否正在创建项目（确认后禁用按钮） */
  creating: boolean;
  /** 创建失败时的错误信息（显示在弹窗内，可重试） */
  error?: string;
  /** 确认创建：传入用户选中的位置；省略则使用默认位置（跳过） */
  onConfirm: (location?: string) => void;
  /** 取消创建（关闭弹窗，返回欢迎页） */
  onCancel: () => void;
}

/** 项目保存位置弹窗：用户选择保存文件夹，或跳过使用默认位置（本程序下 Project 目录） */
export default function SaveLocationDialog({
  projectName,
  creating,
  error,
  onConfirm,
  onCancel,
}: SaveLocationDialogProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [defaultPath, setDefaultPath] = useState('~/.freecoder/Project');
  const [pickError, setPickError] = useState('');

  // 展示默认保存位置（来自设置，主进程侧与实际默认值保持一致）
  useEffect(() => {
    window.electron.settings
      .get()
      .then(({ settings }) => {
        if (settings?.projectsPath) setDefaultPath(settings.projectsPath);
      })
      .catch(() => undefined);
  }, []);

  // ESC 关闭（创建中不允许关闭）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating, onCancel]);

  const handlePick = useCallback(async () => {
    setPicking(true);
    setPickError('');
    try {
      const result = await window.electron.project.selectLocation();
      if (!result.success) {
        setPickError(result.error ?? '无法打开文件夹选择器，请重试');
      } else if (!result.canceled && result.path) {
        setChosen(result.path);
      }
    } catch {
      setPickError('无法打开文件夹选择器，请重试');
    } finally {
      setPicking(false);
    }
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="选择项目保存位置"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => {
        // 点击遮罩关闭（创建中不允许关闭）
        if (e.target === e.currentTarget && !creating) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">📁 将项目保存在哪里？</h2>
            <p className="mt-1 text-sm text-slate-500">
              项目「{projectName}」将以文件夹形式保存。您可以选择位置，或使用默认位置。
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            aria-label="关闭"
            className="shrink-0 rounded-lg px-2 py-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {chosen ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="shrink-0 text-slate-500">已选择：</span>
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={chosen}>
                {chosen}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="shrink-0 text-slate-500">默认位置：</span>
              <span className="min-w-0 flex-1 truncate text-slate-500" title={defaultPath}>
                {defaultPath}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void handlePick()}
            disabled={picking || creating}
            className="mt-3 w-full rounded-lg border border-brand/40 bg-white py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {picking ? '打开中…' : chosen ? '重新选择文件夹…' : '📂 选择文件夹…'}
          </button>
          {pickError && <p className="mt-2 text-xs text-red-500">{pickError}</p>}
        </div>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onConfirm(undefined)}
            disabled={creating}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            跳过，使用默认位置
          </button>
          <button
            type="button"
            onClick={() => chosen && onConfirm(chosen)}
            disabled={!chosen || creating}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? '创建中…' : '在此位置创建项目'}
          </button>
        </div>
      </div>
    </div>
  );
}
