import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/types/electron';

/**
 * WP-01 最小骨架：三栏布局占位（对话/预览/导出将在后续工作包实现）。
 * 布局与视觉规范见《FreeCoder 前端设计说明书》第二章。
 */
export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.electron.app
      .getInfo()
      .then(setAppInfo)
      .catch(() => setAppInfo(null));
  }, []);

  return (
    <div className="flex h-screen flex-col">
      {/* 标题栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <h1 className="text-base font-semibold text-slate-800">✨ FreeCoder</h1>
        <div className="text-xs text-slate-400">
          {appInfo ? `v${appInfo.version} · Electron ${appInfo.electron}` : '…'}
        </div>
      </header>

      {/* 主体：左侧栏 + 工作区（右侧面板后续加入） */}
      <main className="flex flex-1 overflow-hidden">
        <nav className="w-16 shrink-0 border-r border-slate-200 p-2">
          <div className="flex flex-col items-center gap-3 pt-2 text-xs text-slate-400">
            <span className="text-slate-700">💬</span>
            <span>🔍</span>
            <span>📦</span>
            <span>⚙️</span>
          </div>
        </nav>
        <section className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-slate-50 p-10 text-center">
            <p className="text-lg font-medium text-slate-700">欢迎来到 FreeCoder</p>
            <p className="mt-2 text-sm text-slate-500">
              把想法变成可用的软件，像跟朋友聊天一样简单。
            </p>
          </div>
        </section>
      </main>

      {/* 状态栏 */}
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-slate-200 px-4 text-xs text-slate-400">
        <span>● DeepSeek API 未连接</span>
        <span>项目保存在本地</span>
      </footer>
    </div>
  );
}
