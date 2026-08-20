import { useUiStore } from '../store/ui';

/** 左侧导航栏（前端设计说明书 2.2） */
export default function Sidebar() {
  const currentView = useUiStore((s) => s.currentView);
  const setView = useUiStore((s) => s.setView);

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
        <span title="导出">📦</span>
        <span title="设置">⚙️</span>
      </div>
    </nav>
  );
}
