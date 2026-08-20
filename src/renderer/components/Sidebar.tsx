import { useUiStore } from '../store/ui';
import { useExportStore } from '../store/export';

/** 左侧导航栏（前端设计说明书 2.2） */
export default function Sidebar() {
  const currentView = useUiStore((s) => s.currentView);
  const setView = useUiStore((s) => s.setView);
  const openExport = useExportStore((s) => s.open);
  const openSettings = useUiStore((s) => s.openSettings);

  const items = [
    { key: 'chat', icon: '💬', label: '对话' },
    { key: 'preview', icon: '🔍', label: '预览' },
  ] as const;

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-slate-200 bg-white py-3">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => setView(item.key)}
          title={item.label}
          className={`flex h-11 w-11 flex-col items-center justify-center rounded-lg text-xs transition-colors ${
            currentView === item.key
              ? 'bg-brand/10 text-brand'
              : 'text-slate-400 hover:bg-slate-100'
          }`}
        >
          <span className="text-lg leading-none">{item.icon}</span>
          <span className="mt-0.5">{item.label}</span>
        </button>
      ))}
      <div className="mt-auto flex flex-col items-center gap-2 text-slate-400">
        <button
          type="button"
          onClick={openExport}
          title="导出部署包"
          className="flex h-11 w-11 flex-col items-center justify-center rounded-lg text-xs transition-colors hover:bg-slate-100"
        >
          <span className="text-lg leading-none">📦</span>
          <span className="mt-0.5">导出</span>
        </button>
        <button
          type="button"
          onClick={openSettings}
          title="设置（大模型 API）"
          aria-label="设置"
          className="flex h-11 w-11 flex-col items-center justify-center rounded-lg text-xs transition-colors hover:bg-slate-100"
        >
          <span className="text-lg leading-none">⚙️</span>
          <span className="mt-0.5">设置</span>
        </button>
      </div>
    </nav>
  );
}
