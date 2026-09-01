import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 通用 Split Button 组件：一个主按钮 + 右侧 ▾ 切换按钮，点击 ▾ 弹出菜单选项。
 *
 * 典型用法：
 * - "复制" 类操作（复制路径、复制图片、复制 file:// URL 等），主按钮按当前选项执行，
 *   ▾ 切格式 / 切动作。
 *
 * **状态归属（关键）**：
 * - `value`（当前选项）是 **受控** 的，由 caller 持有 + 持久化；组件只读不存。
 * - 菜单的 open / close 状态是 **非受控** 的，组件内部管理，外部点击 / Esc 自动关闭。
 * - 这意味着 caller 不需要重写 outside-click / Esc 处理，但要负责把 `value` 同步到组件。
 *
 * 设计要点：
 * - `tone` 控制主按钮的颜色（idle / success / error），caller 根据业务状态切换。
 * - 主按钮与菜单项内容可通过 renderMain / renderOption 自定义；不传则用 option 默认渲染。
 *
 * @example
 * ```tsx
 * <SplitButtonMenu<'relative' | 'absolute' | 'markdown'>
 *   value={pathCopyMode}
 *   options={PATH_COPY_MODES}
 *   tone={pathCopyState === 'copied' ? 'success' : 'idle'}
 *   onMainClick={handleCopyPath}
 *   onSelect={handleSelectMode}
 *   renderMain={(active) => (
 *     <>{active.icon}<span>复制 · {active.label}</span></>
 *   )}
 * />
 * ```
 */
export interface SplitButtonMenuOption<T extends string> {
  key: T;
  /** 主按钮 / 菜单项主标题 */
  label: string;
  /** 菜单项副标题（描述当前选项的样例） */
  description?: string;
  /** 主按钮或菜单项前的图标（emoji / SVG / 字符） */
  icon?: ReactNode;
}

export type SplitButtonTone = 'idle' | 'success' | 'error';

export interface SplitButtonMenuProps<T extends string> {
  /** 当前激活的选项 key：决定主按钮显示哪个 option、菜单项上显示 ✓ */
  value: T;
  /** 选项列表 */
  options: ReadonlyArray<SplitButtonMenuOption<T>>;
  /** 点击主按钮（caller 按当前 value 执行对应动作） */
  onMainClick: () => void;
  /** 点击菜单项：组件内部先关闭菜单，再回调给 caller */
  onSelect: (key: T) => void;
  /** 自定义主按钮渲染（图标 + 文案）；tone 由 caller 控制。 */
  renderMain?: (activeOption: SplitButtonMenuOption<T>) => ReactNode;
  /** 自定义菜单项渲染（默认渲染 label + description + icon） */
  renderOption?: (option: SplitButtonMenuOption<T>, active: boolean) => ReactNode;
  /** 主按钮色调：idle 灰 / success 绿 / error 红 */
  tone?: SplitButtonTone;
  /** 主按钮 aria-label（屏幕阅读器朗读） */
  mainAriaLabel?: string;
  /** ▾ 按钮 aria-label，默认"切换选项" */
  toggleAriaLabel?: string;
  /** 菜单弹出方向：默认 'up'（向上），适合 footer / 底部区域 */
  menuPlacement?: 'up' | 'down';
  /** 菜单宽度（Tailwind 类），默认 w-64 */
  menuWidthClass?: string;
}

const MAIN_TONE_CLASS: Record<SplitButtonTone, string> = {
  idle: 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
  success: 'bg-emerald-50 text-emerald-600',
  error: 'bg-rose-50 text-rose-600',
};

const TOGGLE_OPEN_CLASS = 'border-slate-300 bg-slate-100 text-slate-700';
const TOGGLE_IDLE_CLASS = 'border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700';

const PLACEMENT_CLASS = {
  up: 'bottom-full mb-1',
  down: 'top-full mt-1',
} as const;

export function SplitButtonMenu<T extends string>({
  value,
  options,
  onMainClick,
  onSelect,
  renderMain,
  renderOption,
  tone = 'idle',
  mainAriaLabel,
  toggleAriaLabel = '切换选项',
  menuPlacement = 'up',
  menuWidthClass = 'w-64',
}: SplitButtonMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /** 菜单打开时，点击外部或按 Esc 自动关闭 */
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const activeOption = options.find((o) => o.key === value) ?? options[0];

  const handleSelect = (key: T) => {
    setOpen(false);
    onSelect(key);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-stretch overflow-hidden rounded-md border border-slate-200 bg-white">
        <button
          type="button"
          onClick={onMainClick}
          aria-label={mainAriaLabel}
          className={`flex items-center gap-1 px-2 py-0.5 text-[11px] transition-colors ${MAIN_TONE_CLASS[tone]}`}
        >
          {renderMain ? (
            renderMain(activeOption as SplitButtonMenuOption<T>)
          ) : (
            <>
              {activeOption?.icon != null && (
                <span aria-hidden="true">{activeOption.icon}</span>
              )}
              <span>{activeOption?.label ?? ''}</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={toggleAriaLabel}
          className={`flex items-center border-l px-1.5 text-[11px] transition-colors ${
            open ? TOGGLE_OPEN_CLASS : TOGGLE_IDLE_CLASS
          }`}
        >
          <span aria-hidden="true">▾</span>
        </button>
      </div>
      {open && (
        <div
          role="menu"
          className={`absolute left-0 z-20 ${menuWidthClass} rounded-md border border-slate-200 bg-white py-1 shadow-lg ${PLACEMENT_CLASS[menuPlacement]}`}
        >
          {options.map((option) => {
            const active = option.key === value;
            return (
              <button
                key={option.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => handleSelect(option.key)}
                className={`flex w-full items-start justify-between gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-slate-50 ${
                  active ? 'text-brand' : 'text-slate-700'
                }`}
              >
                {renderOption ? (
                  renderOption(option, active)
                ) : (
                  <>
                    <div className="min-w-0">
                      <div className="font-medium">
                        {option.icon != null && (
                          <span aria-hidden="true" className="mr-1">
                            {option.icon}
                          </span>
                        )}
                        {option.label}
                      </div>
                      {option.description != null && (
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {option.description}
                        </div>
                      )}
                    </div>
                    {active && (
                      <span aria-hidden="true" className="shrink-0 text-brand">
                        ✓
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
