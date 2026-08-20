import type { PreviewStatus } from '@shared/types/preview';

interface PreviewToolbarProps {
  url: string | null;
  status: PreviewStatus;
  onRefresh: () => void;
  onOpenExternal: () => void;
}

/** 预览工具栏（前端设计说明书 3.3：刷新 / 截图） */
export default function PreviewToolbar({ url, status, onRefresh, onOpenExternal }: PreviewToolbarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3">
      <span className="text-xs text-slate-400">
        {status === 'running' ? '🟢 预览运行中' : status === 'starting' ? '🟡 启动中…' : '⚪ 未启动'}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{url ?? '—'}</span>
      <button
        type="button"
        onClick={onRefresh}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
      >
        🔄 刷新
      </button>
      <button
        type="button"
        onClick={onOpenExternal}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
      >
        ↗ 新窗口
      </button>
    </div>
  );
}
