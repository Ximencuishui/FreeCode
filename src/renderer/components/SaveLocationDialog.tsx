import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * 项目保存位置弹窗：用户选择保存文件夹，或跳过使用默认位置（本程序下 Project 目录）。
 *
 * v3.2.2 P2-19：迁到原生 <dialog> + showModal()。
 * - 浏览器内置 ESC 关闭（无需自己挂 keydown 监听）。
 * - 内置 focus trap（焦点被锁在弹窗内，键盘用户不会逃到背景元素上）。
 * - 内置 ::backdrop 伪元素遮罩（用 ::backdrop CSS 而非自己的 z-index 层）。
 * - 自带 inert / aria-modal 语义，screen reader 也能正确识别。
 *
 * 副作用：showModal/close 必须在 dialog ref 上同步调用，否则浏览器忽略。
 * 因此组件始终挂载（不根据"是否打开"卸载），用 ref.current[show|close]() 控制显隐。
 */
export default function SaveLocationDialog({
  projectName,
  creating,
  error,
  onConfirm,
  onCancel,
}: SaveLocationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [defaultPath, setDefaultPath] = useState('~/.freecoder/Project');
  const [pickError, setPickError] = useState('');
  // v3.2.2 P1-15：记录 trigger 以便关闭时还焦点。
  const triggerRef = useRef<HTMLElement | null>(null);
  // v3.2.2 P1-15-1：标记「是否首次挂载」。React StrictMode 下 useEffect 会跑两遍：
  //   第一次 mount：记录 trigger + showModal；unmount：close
  //   第二次 mount：document.activeElement 已是 dialog 自身，若再覆盖 triggerRef 会导致
  //   关闭时把焦点还给 dialog（已卸载的元素），fallback 到 body，键盘用户体验割裂。
  // 用 wasMountedRef 守门，第二次 mount 时不覆盖 triggerRef，复用首次记录的真实 trigger。
  const wasMountedRef = useRef(false);

  // 展示默认保存位置（来自设置，主进程侧与实际默认值保持一致）
  useEffect(() => {
    window.electron.settings
      .get()
      .then(({ settings }) => {
        if (settings?.projectsPath) setDefaultPath(settings.projectsPath);
      })
      .catch(() => undefined);
  }, []);

  // v3.2.2 P2-19：始终挂载 <dialog>，挂载后立刻 showModal() 进入模态态。
  // 卸载时 close() 让浏览器释放模态焦点。
  // 防御性：jsdom 不支持 HTMLDialogElement.showModal/close（无 ::backdrop 实现），
  // typeof 检查 + 可选 mock 跳过真实调用，避免测试环境抛 TypeError。
  // 生产环境 Electron 渲染进程 Chromium 完整支持，正常进入模态态。
  // v3.2.2 P1-15-1：wasMountedRef 守门，首次挂载才记录 trigger + showModal。
  // StrictMode 第二次 mount 时 document.activeElement 已是 dialog 自身，复用首次记录避免误还焦点。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!wasMountedRef.current) {
      // 记录触发元素，关闭时还焦点
      triggerRef.current = document.activeElement as HTMLElement | null;
      if (typeof dialog.showModal === 'function' && !dialog.open) {
        dialog.showModal();
      }
      wasMountedRef.current = true;
    }
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) {
        dialog.close();
      }
    };
  }, []);

  // v3.2.2 P2-19：原生 <dialog> 的 close 事件由用户点遮罩或按 Esc 触发。
  // 浏览器原生行为不会调我们的 onCancel，这里桥接到组件的 onCancel + 还焦点。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = (): void => {
      // 还原焦点到触发元素（避免键盘用户焦点掉回 body）
      triggerRef.current?.focus();
      // 创建中禁止关闭：浏览器原生 dialog 已经关了，我们补一次 showModal 顶回去
      if (creating && typeof dialog.showModal === 'function') {
        dialog.showModal();
        return;
      }
      onCancel();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
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
    <dialog
      ref={dialogRef}
      aria-label="选择项目保存位置"
      className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl backdrop:bg-black/30"
      // v3.2.2 P2-19：原生 <dialog> 自带 ESC / focus trap / ::backdrop，
      // 不需要自己实现 onMouseDown 关遮罩 + window keydown 监听。
      // 点击遮罩关闭由 close 事件桥接（见上面 useEffect），无需在这里手动拦事件。
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">📁 将项目保存在哪里？</h2>
          <p className="mt-1 text-sm text-slate-500">
            项目「{projectName}」将以文件夹形式保存。您可以选择位置，或使用默认位置。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            // v3.2.2 P2-19：调原生 close() 触发 close 事件，由上面 useEffect 桥接到 onCancel + 还焦点。
            // 防御性 typeof：jsdom 无 close 时直接调 onCancel 保持测试可达。
            if (typeof dialogRef.current?.close === 'function') {
              dialogRef.current.close();
            } else {
              onCancel();
            }
          }}
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
          <div className="text-sm">
            {/* v3.2.1 P2-9：明示默认位置就是「应用内」+ 路径，避免用户对"默认位置"含义模糊。
                原来"应用内文件夹"对非技术用户来说含义不清。 */}
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-slate-500">默认位置：</span>
              <span className="min-w-0 flex-1 truncate text-slate-500" title={defaultPath}>
                {defaultPath}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              💡 即 FreeCoder 程序所在目录的 <code className="rounded bg-slate-200 px-1 py-0.5">Project/</code> 子文件夹；项目数据完全本地保存，不会上传。
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => void handlePick()}
          disabled={picking || creating}
          className="mt-3 w-full rounded-lg border border-brand/40 bg-white py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {picking ? '打开中…' : chosen ? '重新选择文件夹' : '📁 选择文件夹'}
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
    </dialog>
  );
}
