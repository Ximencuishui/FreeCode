import { useEffect, useRef, useState, useCallback } from 'react';
import { useProjectStore } from '../store/project';
import { PROJECT_STATUS_LABEL } from './projectStatus';

interface ProjectStatusBadgeProps {
  /** 项目状态字面量（ProjectStatus 类型子集即可）；缺失时回退到 status 原文 */
  status: string;
  /** v3.2.1 P2-4：徽标尺寸 —— 'compact' 用于 ProjectSwitcher 紧凑列表（10px text-[10px]），
   *  'card' 用于 ProjectWelcome 卡片式列表（11px + 圆角全徽标）。 */
  variant?: 'compact' | 'card';
}

/** v3.2.1 P2-4：项目状态徽标（共用组件）。
 * 之前 ProjectWelcome 和 ProjectSwitcher 各自硬编码一份（前者 `bg-slate-100` 圆角胶囊，
 * 后者 `text-slate-400` 纯文本），样式漂移。现在统一为 ProjectStatusBadge，
 * variant 控制尺寸变体，避免重复维护。 */
export function ProjectStatusBadge({ status, variant = 'compact' }: ProjectStatusBadgeProps) {
  const label = PROJECT_STATUS_LABEL[status] ?? status;
  if (variant === 'card') {
    return (
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
        {label}
      </span>
    );
  }
  return <span className="shrink-0 text-[10px] text-slate-400">{label}</span>;
}

/** 顶部项目切换器：列出所有项目 + 新建入口（此前只能新建、无法切换回已有项目） */
export default function ProjectSwitcher() {
  const projects = useProjectStore((s) => s.projects);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const [open, setOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // v0.1.02 P3-1：键盘高亮索引。-1 表示没有键盘高亮（鼠标 hover/初始态）；
  // 0..projects.length-1 是项目；projects.length 是底部「＋ 新建项目」入口。
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const current = projects.find((p) => p.id === currentProjectId);
  // v0.1.02 P3-8：currentProjectId 指向一个已被删除的项目（异步竞态：主进程已删，
  // 但 React 渲染窗口内 projects 还没刷新；或 store 单独清空 currentProjectId 但 projects 还没重建）
  // 都会让 current=undefined。下面的三元 `current ? current.name : '选择项目'` 已经兜住，
  // 这里额外注释一下意图，方便日后排查"按钮文案变 undefined"类问题。

  // v0.1.02 P3-1：点击外部关闭
  // v3.2.1 P2-5：mousedown → pointerdown，统一处理鼠标 + 触摸 + 笔；
  // 保留 contains() 语义（Node.contains 已能正确判定 SVG/嵌套元素归属）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // 关闭时清掉残留的"确认删除"态——避免下次打开时按钮显示"确认"而不是"🗑"
  // （删除流程也调用了 setConfirmDeleteId(null)，但若用户中途直接按 Esc/外部点击关闭，
  // 这次 reset 也能保证下次打开是干净状态。）
  useEffect(() => {
    if (!open) setConfirmDeleteId(null);
  }, [open]);

  // v0.1.02 P3-1：打开弹窗时把键盘焦点放在"当前项目"上，方便 Enter 直接重选；
  // 关闭时清零；projects 变化时夹紧索引，避免越界（删除最后一个项目时）。
  // v0.1.02 P3-AUDIT：之前仅 setFocusIndex 但没调 item.focus()，导致打开后必须再按
  // Tab 才能进入 listbox 开始 ↑/↓ 导航（Promise 焦点仍停在触发按钮）。改成 setTimeout(0)
  // 等 React 把 itemRefs 提交完再聚焦，符合 ARIA combobox/listbox 期望行为。
  useEffect(() => {
    if (!open) {
      setFocusIndex(-1);
      return;
    }
    const idx = currentProjectId ? projects.findIndex((p) => p.id === currentProjectId) : -1;
    const targetIndex = idx >= 0 ? idx : 0;
    setFocusIndex(targetIndex);
    const focusTimer = window.setTimeout(() => {
      const el = itemRefs.current[targetIndex];
      if (el) el.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [open, currentProjectId, projects]);

  // v0.1.02 P3-1：键盘导航——↑/↓ 在项目之间循环移动，Enter 选中，Esc 关闭。
  // 把 focusIndex 同步到对应 DOM 节点的 .focus()，屏幕阅读器也能跟随朗读。
  const focusItem = (index: number) => {
    const el = itemRefs.current[index];
    if (el) el.focus();
  };
  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      // v3.2.1 P2-11：键盘用户聚焦到项目选项时按 Delete/Backspace 直接删除
      // （无二次确认——避免和"先确认再删"的鼠标流程冲突；后续如担心误删，可加 confirm 对话框）。
      // 仅允许删除非当前项目，避免立刻清空 store 的 currentProjectId 破坏 UI 状态机。
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        focusIndex >= 0 &&
        focusIndex < projects.length
      ) {
        const target = projects[focusIndex];
        if (target && target.id !== currentProjectId) {
          e.preventDefault();
          void deleteProject(target.id);
          return;
        }
      }
      const total = projects.length + 1; // +1 是底部「＋ 新建项目」
      if (total <= 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = focusIndex < 0 ? 0 : (focusIndex + 1) % total;
        setFocusIndex(next);
        focusItem(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = focusIndex < 0 ? total - 1 : (focusIndex - 1 + total) % total;
        setFocusIndex(next);
        focusItem(next);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusIndex(0);
        focusItem(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = total - 1;
        setFocusIndex(last);
        focusItem(last);
      }
    },
    [focusIndex, projects, currentProjectId, deleteProject],
  );

  return (
    <div className="relative ml-2" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="切换项目"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? `当前项目：${current.name}，点击切换` : '选择项目'}
        className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-200"
      >
        <span className="max-w-40 truncate">📁 {current ? current.name : '选择项目'}</span>
        <span className="text-[10px] text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          role="listbox"
          aria-label="选择项目"
          // v0.1.02 P3-1：键盘焦点在 listbox 内循环，按 ↑/↓/Home/End 在项目之间移动；
          // Enter 由每个项目 button 自带默认行为触发 onClick；Esc 关闭弹窗。
          onKeyDown={onListKeyDown}
        >
          <div className="max-h-64 overflow-y-auto p-1">
            {projects.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400">还没有项目，新建一个吧</p>
            )}
            {projects.map((p, idx) => (
              <div
                key={p.id}
                // v0.1.02 P1-5：group 类让子按钮的 group-focus-within 生效（键盘 Tab 时也显示删除按钮）
                className={`group flex items-center gap-1 rounded-lg px-1 transition-colors hover:bg-slate-50 ${
                  p.id === currentProjectId ? 'bg-brand/5' : ''
                }`}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === currentProjectId}
                  // v0.1.02 P3-1：把每个项目按钮挂到 itemRefs，让 ↑/↓ 可聚焦
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  onClick={() => {
                    selectProject(p.id);
                    // v0.1.02 P1-3：切换项目时清掉删除确认态，避免下次打开时残留"确认"按钮
                    setConfirmDeleteId(null);
                    setOpen(false);
                  }}
                  // v0.1.02 P3-1：聚焦时高亮 + 数据属性方便 e2e 找到当前键盘高亮项
                  data-keyboard-focus={focusIndex === idx ? 'true' : undefined}
                  className={`flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-2 text-left text-sm transition-colors focus:bg-slate-100 focus:outline-none ${
                    p.id === currentProjectId
                      ? 'text-brand'
                      : focusIndex === idx
                        ? 'bg-slate-100 text-slate-800'
                        : 'text-slate-700'
                  }`}
                >
                  <span className="truncate">📁 {p.name}</span>
                  {/* v3.2.1 P2-4：状态徽标改用 ProjectStatusBadge 共用组件 */}
                  <ProjectStatusBadge status={p.status} />
                </button>
                {confirmDeleteId === p.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      void deleteProject(p.id);
                      setConfirmDeleteId(null);
                    }}
                    className="shrink-0 rounded bg-red-500 px-1.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-red-600"
                    aria-label={`确认删除 ${p.name}`}
                  >
                    确认
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(p.id)}
                    title="删除项目"
                    aria-label={`删除 ${p.name}（按 Delete 键可一键删除）`}
                    // v0.1.02 P1-5：focus-within 让键盘 Tab 到卡片时按钮可见，无需鼠标 hover
                    className="shrink-0 rounded p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:bg-red-50 focus-visible:text-red-600 group-focus-within:text-red-400"
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
              role="option"
              // v0.1.02 P3-1：把"新建项目"挂到 itemRefs 的最后一位
              ref={(el) => {
                itemRefs.current[projects.length] = el;
              }}
              onClick={() => {
                selectProject(null);
                // v0.1.02 P1-3：新建项目入口也要清掉确认态，避免下次打开弹出"确认删除"按钮
                setConfirmDeleteId(null);
                setOpen(false);
              }}
              data-keyboard-focus={focusIndex === projects.length ? 'true' : undefined}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors focus:bg-slate-100 focus:outline-none ${
                focusIndex === projects.length ? 'bg-slate-100 text-slate-800' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              ＋ 新建项目
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
