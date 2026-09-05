import type { PreviewStatus } from '@shared/types/preview';

interface PreviewToolbarProps {
  url: string | null;
  status: PreviewStatus;
  onRefresh: () => void;
  onOpenExternal: () => void;
  /** 当前项目是否本地模式（authentication === 'none'）；
   *  为 true 时隐藏「转本地模式」按钮（已是本地模式）。 */
  localMode?: boolean;
  /** 转本地模式请求中（请求未完成时禁用按钮） */
  converting?: boolean;
  /** 点击「转本地模式」按钮：弹窗确认后走 IPC；失败在 PreviewContainer 顶部提示。 */
  onConvertToLocalMode?: () => void;
}

/** 预览工具栏：刷新 / 用浏览器打开并测试。
 * 注意：元素选择开关（🎯 选择元素）已迁到右侧 AI 助理面板的「🔍 元素」Tab 顶部，
 * 这里只保留预览生命周期相关的操作，避免工具栏挤占关键控件的视觉权重。 */
export default function PreviewToolbar({
  url,
  status,
  onRefresh,
  onOpenExternal,
  localMode,
  converting,
  onConvertToLocalMode,
}: PreviewToolbarProps) {
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
      {/* 「转本地模式」按钮：仅在预览运行中、当前为登录模式、且未在转的过程中可见可点。
          预览 running 一般意味着应用已就绪（status=ready），此时引导用户切换才有意义。 */}
      {!localMode && status === 'running' && onConvertToLocalMode && (
        <button
          type="button"
          onClick={onConvertToLocalMode}
          disabled={converting}
          title="删除登录功能并改为本地存储（需重新生成代码）"
          className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {converting ? '⏳ 切换中…' : '🔓 转本地模式'}
        </button>
      )}
      <button
        type="button"
        onClick={onOpenExternal}
        className="rounded-md border border-brand bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-hover"
      >
        🌐 用浏览器打开并测试
      </button>
    </div>
  );
}
