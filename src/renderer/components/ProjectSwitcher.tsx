import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/project';

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  draft: '需求中',
  planned: '规划中',
  developing: '开发中',
  ready: '已就绪',
  exported: '已导出',
};

/** 顶部项目切换器：列出所有项目 + 新建入口（此前只能新建、无法切换回已有项目） */
export default function ProjectSwitcher() {
  const projects = useProjectStore((s) => s.projects);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const [open, setOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const current = projects.find((p) => p.id === currentProjectId);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative ml-2" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="切换项目"
        className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-200"
      >
        <span className="max-w-40 truncate">📁 {current ? current.name : '选择项目'}</span>
        <span className="text-[10px] text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-64 overflow-y-auto p-1">
            {projects.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400">还没有项目，新建一个吧</p>
            )}
            {projects.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-1 rounded-lg px-1 transition-colors hover:bg-slate-50 ${
                  p.id === currentProjectId ? 'bg-brand/5' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    selectProject(p.id);
                    setOpen(false);
                  }}
                  className={`flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-2 text-left text-sm transition-colors ${
                    p.id === currentProjectId ? 'text-brand' : 'text-slate-700'
                  }`}
                >
                  <span className="truncate">📁 {p.name}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {PROJECT_STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </button>
                {confirmDeleteId === p.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      void deleteProject(p.id);
                      setConfirmDeleteId(null);
                    }}
                    className="shrink-0 rounded bg-red-500 px-1.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-red-600"
                  >
                    确认
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(p.id)}
                    title="删除项目"
                    aria-label={`删除 ${p.name}`}
                    className="shrink-0 rounded p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                selectProject(null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-50"
            >
              ＋ 新建项目
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
