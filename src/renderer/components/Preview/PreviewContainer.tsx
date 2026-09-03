import { useEffect, useRef, useState, useCallback } from 'react';
import type { PreviewStatus, ElementInfo, ElementSelectResult } from '@shared/types/preview';
import { useProjectStore } from '../../store/project';
import { useChatStore } from '../../store/chat';
import { useUiStore } from '../../store/ui';
import PreviewToolbar from './PreviewToolbar';
import ConfirmDialog from '../common/ConfirmDialog';

/** 探测应用后端 API（登录/数据 API）是否可用，返回错误信息（null 表示正常） */
async function probeBackend(baseUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.ok) return null;
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) detail = data.error;
    } catch {
      /* 非 JSON 响应，保留状态码 */
    }
    return detail;
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError' ? '请求超时' : '无法连接';
    return `${msg}（${baseUrl}）`;
  } finally {
    clearTimeout(timer);
  }
}

/** 预览视图：内嵌 WebView 显示生成的应用，支持元素悬停识别（前端设计说明书 3.3） */
export default function PreviewContainer() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  /** 当前项目是否本地模式（authentication === 'none'）。本地模式无登录后端运行时，
   *  不探测 /api/health，也不展示「应用后端不可用」提示。 */
  const localMode = useChatStore((s) => s.requirements?.authentication === 'none');
  const [url, setUrl] = useState<string | null>(null);
  const [inspectorPath, setInspectorPath] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>('stopped');
  const [error, setError] = useState('');
  /** 本地模式无后端运行时，该状态永远为 null，保持探测 API 完整以便未来扩展 */
  const [backendError, setBackendError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const webviewRef = useRef<HTMLElement | null>(null);
  /** 重试计数：+1 触发重新 start（stop → start） */
  const [restartKey, setRestartKey] = useState(0);
  const urlRef = useRef<string | null>(null);
  urlRef.current = url;
  /** 上一次探测结果（用于判断“后端恢复”，避免健康时无谓刷新页面） */
  const backendErrorRef = useRef<string | null>(null);
  backendErrorRef.current = backendError;
  /** 本地模式标记的 ref（在 checkBackend 异步路径里读最新值，避免 useCallback 闭包过期） */
  const localModeRef = useRef(localMode);
  localModeRef.current = localMode;
  /** webview 是否已完成 dom-ready（send() 在此之前调用会抛错） */
  const webviewReadyRef = useRef(false);

  // 元素选择模式开关 → 通知 webview 检查器（关掉后预览可正常点击测试）。
  // 注意：webview 的 preload (inspector.js) 在 webview 加载完成前不会注册 IPC 监听器，
  // 直接 send 会丢消息（且未 dom-ready 时调用 send() 会抛错打断渲染）。每次
  // webview 完成加载后也要重发一次当前状态。
  useEffect(() => {
    if (!webviewReadyRef.current) return;
    const wv = webviewRef.current as unknown as { send?: (ch: string, ...args: unknown[]) => void } | null;
    wv?.send?.('preview-mode', selectMode ? 'select' : 'normal');
  }, [selectMode, url]);

  /** webview 完成加载后再次同步当前 selectMode（确保 preload 已注册 IPC 后收到指令）） */
  const onWebviewLoad = useCallback(() => {
    webviewReadyRef.current = true;
    const wv = webviewRef.current as unknown as { send?: (ch: string, ...args: unknown[]) => void } | null;
    wv?.send?.('preview-mode', selectMode ? 'select' : 'normal');
  }, [selectMode]);

  // 注册 webview did-finish-load 监听器（每次 webview 加载完成时把当前 selectMode 同步过去）
  useEffect(() => {
    webviewReadyRef.current = false;
    const wv = webviewRef.current as unknown as {
      addEventListener?: (ch: string, fn: (...args: unknown[]) => void) => void;
      removeEventListener?: (ch: string, fn: (...args: unknown[]) => void) => void;
    } | null;
    if (!wv?.addEventListener || !wv?.removeEventListener) return;
    const handler = () => onWebviewLoad();
    wv.addEventListener('did-finish-load', handler);
    return () => {
      wv.removeEventListener?.('did-finish-load', handler);
    };
  }, [url, onWebviewLoad]);

  const reload = () => {
    const wv = webviewRef.current as unknown as { reload: () => void } | null;
    wv?.reload();
  };

  /** 转本地模式：调主进程 IPC，成功后通知父组件（App 负责切视图 + 刷新状态）
   * v0.1.02 P0-2：转换成功后主进程已主动清空 versionPlan 并触发 planner 重新生成，
   * 渲染端需要同步清空本地 store 里的 versionPlan，确保 chat 视图的"正在生成版本分段计划"
   * 提示立刻出现，避免用户看到一份基于 password 模式的旧计划。
   *
   * v0.1.02 P2-4：成功转换后，主动 stop 当前预览服务器（基于 password authentication 的旧
   * 应用已废弃，避免用户切回预览视图看到旧应用 / 报后端不可用）。
   * 之后自动切到对话页：用户看到主进程推送的"已切换为本地模式，请等待版本计划重新生成后
   * 确认 V1 计划"系统消息，按引导确认新 V1 → 重新开发 → 再切回 preview 即可看到新应用。
   *
   * v3.2.1 P1-1：使用自研 ConfirmDialog 替代 window.confirm，提供品牌化样式与防误操作焦点。 */
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [confirmConvertOpen, setConfirmConvertOpen] = useState(false);
  const convertToLocalMode = useCallback(async () => {
    if (!currentProjectId || converting) return;
    setConfirmConvertOpen(true);
  }, [currentProjectId, converting]);

  const doConvertToLocalMode = useCallback(async () => {
    if (!currentProjectId) return;
    setConfirmConvertOpen(false);
    setConverting(true);
    setConvertError(null);
    try {
      const result = await window.electron.project.convertToLocalMode({
        projectId: currentProjectId,
      });
      if (!result.success) {
        setConvertError(result.error ?? '转本地模式失败');
        setConverting(false);
        return;
      }
      // v0.1.02 P2-4：成功 → 主动 stop 预览服务器，避免用户切回预览时看到旧 password 模式应用
      try {
        await window.electron.preview.stop();
      } catch {
        /* 未在运行：忽略 */
      }
      // 刷新项目状态（状态已变为 planned，versionPlan 已清空，主进程后台正在重生计划）
      if (currentProjectId) {
        await useProjectStore.getState().loadProjects();
        try {
          const r = await window.electron.project.get({ projectId: currentProjectId });
          if (r.success && r.project) {
            // ProjectGetResult.requirements 缺 confirmed 字段；前端 store 要求完整 RequirementSummary，
            // 用 confirmed=false 占位（projectStatus=planned 时不会显示需求确认卡）
            const refreshed = { ...r.project.requirements, confirmed: false };
            useChatStore.getState().setRequirements(refreshed as never);
            // ProjectStatus 是字面量联合，直接断言即可
            useChatStore.getState().setProjectStatus(
              r.project.status as 'draft' | 'planned' | 'developing' | 'ready' | 'exported',
            );
            // v0.1.02 P0-2：主进程已主动清空 versionPlan 并触发 planner 重新生成；
            // 渲染端立即同步清空本地 store，确保 chat 视图的"正在生成版本分段计划"提示立刻出现。
            // （若不立即清空，用户会看到一份基于 password 模式的旧计划。）
            useChatStore.getState().setVersionPlan(null);
          }
        } catch {
          /* 刷新失败不影响主流程 */
        }
      }
      // 状态已变为 planned → 自动切到对话页让用户看到「正在生成版本分段计划…」提示
      useUiStore.getState().setView('chat');
      setConverting(false);
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : '转本地模式失败');
      setConverting(false);
    }
  }, [currentProjectId]);

  /** 探测应用后端 API；本地模式（authentication === 'none'）无后端运行时直接跳过。
   *  探测本身会触发预览服务器的自愈重载。 */
  const checkBackend = useCallback(async () => {
    const base = urlRef.current;
    if (!base) return;
    // 本地模式：项目不依赖 server.js / auth.js，没有后端 API 可探测。
    // 避免对纯前端应用误报“应用后端不可用”。
    if (localModeRef.current) return;
    const problem = await probeBackend(base);
    const wasBroken = backendErrorRef.current !== null;
    setBackendError(problem);
    // 后端从故障恢复（或探测触发自愈成功）时刷新页面，让应用重新走登录/初始化
    if (!problem && wasBroken) reload();
  }, []);

  // webview 完成加载后探测后端可用性（延迟到页面脚本跑起来）
  useEffect(() => {
    if (status !== 'running' || !url) return;
    const timer = setTimeout(() => {
      void checkBackend();
    }, 1200);
    return () => clearTimeout(timer);
  }, [url, status, checkBackend]);

  // 元素检查：webview 通过 ipc-message 上报点击元素
  useEffect(() => {
    if (!inspectorPath) return;
    const wv = webviewRef.current;
    if (!wv) return;

    const handler = (e: Event) => {
      const ev = e as unknown as { channel?: string; args?: unknown[] };
      if (ev.channel !== 'preview-element' || !ev.args?.length) return;
      const element = ev.args[0] as ElementInfo;
      void window.electron.preview.selectElement({ element }).then((r: ElementSelectResult) => {
        if (r.success && r.elementInfo) {
          useChatStore.getState().setSelectedElement(element);
          useChatStore.getState().setElementInfo(r.elementInfo);
        }
      });
    };

    wv.addEventListener('ipc-message', handler);
    return () => wv.removeEventListener('ipc-message', handler);
  }, [inspectorPath, webviewRef]);

  useEffect(() => {
    if (!currentProjectId) {
      setUrl(null);
      setInspectorPath(null);
      setStatus('stopped');
      setError('');
      setBackendError(null);
      return;
    }

    // 先注册状态订阅（const），再启动预览
    const unsub = window.electron.preview.onStatus((e) => {
      setStatus(e.status);
      if (e.url) setUrl(e.url);
      if (e.reload) reload();
      if (e.status === 'error' && e.message) setError(e.message);
    });

    setStatus('starting');
    setError('');
    setBackendError(null);
    window.electron.preview
      .start({ projectId: currentProjectId })
      .then((r) => {
        if (r.success && r.url) {
          setUrl(r.url);
          setInspectorPath(r.inspectorPath ?? null);
          setStatus('running');
          setError('');
        } else {
          // 运行时 error 可能是 FreeCoderError 对象（类型标注为 string，属历史类型缺口）
          const raw = r.error as unknown;
          const message =
            typeof raw === 'string'
              ? raw
              : raw && typeof raw === 'object' && 'message' in raw
                ? String((raw as { message: unknown }).message)
                : '预览启动失败';
          setError(message);
        }
      })
      .catch((err) => {
        const msg =
          (err && typeof err === 'object' && 'error' in err
            ? String((err as { error: { message: string } }).error.message)
            : undefined) ?? '预览启动失败';
        setError(msg);
      });

    return () => {
      unsub();
    };
    // restartKey：用户在错误态点击「重试」时先 stop 再重新 start
  }, [currentProjectId, restartKey]);

  /** 错误态重试：先停止预览服务器，再重新启动（修复被毒化的后端实例） */
  const retryPreview = async () => {
    setError('');
    setBackendError(null);
    setStatus('starting');
    try {
      await window.electron.preview.stop();
    } catch {
      /* 未在运行：忽略 */
    }
    setRestartKey((k) => k + 1);
  };

  const openExternal = () => {
    // 用系统浏览器打开当前预览（真实测试，不受元素选择干扰）
    void window.electron.preview.openExternal().catch(() => undefined);
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <PreviewToolbar
        url={url}
        status={status}
        selectMode={selectMode}
        onToggleSelect={() => setSelectMode((v) => !v)}
        onRefresh={reload}
        onOpenExternal={openExternal}
        localMode={localMode}
        converting={converting}
        onConvertToLocalMode={convertToLocalMode}
      />
      {/* 修复 P1-6：元素选择模式提示横幅。进入 selectMode 后在预览顶部显示一条
          高对比度的固定横幅，告诉用户「现在是选元素模式，在画布点一下任意组件」；
          之前只有工具栏按钮高亮，没有全画布视觉信号，用户不知道发生了什么，
          容易以为应用出 bug。横幅上同时提供「退出」快捷入口，避免用户忘掉模式状态。 */}
      {selectMode && (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-brand/30 bg-brand/10 px-3 py-1.5 text-xs text-brand"
          data-testid="fc-preview-select-mode-banner"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">🎯</span>
          <span className="min-w-0 flex-1 truncate font-medium text-brand">
            元素选择模式已开启
          </span>
          <span className="hidden text-brand/80 sm:inline">在画布上点一下任意组件查看信息</span>
          <button
            type="button"
            onClick={() => setSelectMode(false)}
            className="shrink-0 rounded-md border border-brand/30 bg-white px-2 py-0.5 font-medium text-brand transition-colors hover:bg-brand/5"
            title="退出选择模式，恢复正常测试"
          >
            ✕ 退出
          </button>
        </div>
      )}
      {/* 转本地模式出错时提示（仅登录模式可能出现） */}
      {convertError && !localMode && (
        // v3.2.1 P3-5：错误提示加「重试」按钮，避免用户只能关闭应用或重启项目
        // 才能再试一次。重试直接调 doConvertToLocalMode（用户已确认过一次）。
        <div className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          <span className="min-w-0 flex-1 truncate">⚠️ 转本地模式失败：{convertError}</span>
          <button
            type="button"
            onClick={() => void doConvertToLocalMode()}
            disabled={converting}
            className="shrink-0 rounded-md border border-red-300 bg-white px-2 py-1 font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
            title="再次尝试切换到本地模式"
            data-testid="fc-preview-convert-retry"
          >
            {converting ? '重试中…' : '🔄 重试'}
          </button>
        </div>
      )}
      {/* 应用后端 API 不可用提示（页面能打开但后端报错）；本地模式无后端运行时隐藏 */}
      {backendError && url && !localMode && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
          <span className="min-w-0 flex-1 truncate">
            ⚠️ 应用后端暂时不可用：{backendError}（可能是一时的数据库初始化失败，点击重试会自动恢复）
          </span>
          <button
            type="button"
            onClick={() => void checkBackend()}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 font-medium text-amber-700 transition-colors hover:bg-amber-100"
          >
            🔄 重试
          </button>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {/* v3.2.1 P2-12：后端探测失败时不渲染旧 webview（用户可能看到登录失败/白屏），
            改为显示 skeleton + retry。骨架用 amber 提示色呼应顶部 banner，让用户清楚是后端问题。
            顶部 backendError banner 与底部 skeleton 联动：retry 按钮触发 checkBackend()，
            探测成功 → setBackendError(null) → 切回 webview。 */}
        {backendError && url ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-4 p-6"
            data-testid="fc-preview-backend-error"
            role="alert"
            aria-live="assertive"
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="text-4xl" aria-hidden="true">⚠️</span>
              <p className="text-sm font-medium text-amber-700">应用后端暂时不可用</p>
              <p className="max-w-md text-xs text-amber-600/90">
                {backendError}（可能是一时的数据库初始化失败，点击重试会自动恢复）
              </p>
            </div>
            {/* amber 骨架：保留与启动态一致的骨架形态，让用户感知"还在探测" */}
            <div className="w-full max-w-md space-y-2.5" aria-hidden="true">
              <div className="h-10 w-full animate-pulse rounded-lg bg-amber-200/40" />
              <div className="h-32 w-full animate-pulse rounded-lg bg-amber-100/40" />
              <div className="h-6 w-1/2 animate-pulse rounded bg-amber-200/40" />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void checkBackend()}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
                data-testid="fc-preview-backend-retry"
              >
                🔄 重试探测
              </button>
              <button
                type="button"
                onClick={() => void reload()}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100"
                title="重新加载整个预览页面（强制刷新 webview）"
              >
                刷新页面
              </button>
            </div>
          </div>
        ) : url && inspectorPath && status !== 'error' ? (
          <webview
            ref={webviewRef as never}
            src={url}
            preload={inspectorPath}
            className="h-full w-full"
            partition="persist:preview"
          />
        ) : (
          // v3.2.1 P3-7：预览启动中（status='starting' 且有 url）时显示 skeleton，
          // 避免用户看到空白面板不知道发生了什么。skeleton 用 animate-pulse
          // 模拟浏览器内容布局（顶栏 + 侧边栏 + 主区域卡片），启动完成后自动被 webview 替换。
          <div className="flex h-full flex-col items-center justify-center gap-3">
            {status === 'starting' && url ? (
              // v3.2.1 P2-17：aria-busy="true" 让屏幕阅读器知道「内容还在生成中，请稍候」，
              // 配合 role="status" + aria-live="polite" + aria-label 让无障碍体验完整。
              // aria-atomic 保持与 Card 一致，整体朗读一次避免碎读。
              <div
                className="flex h-full w-full flex-col gap-3 p-6"
                data-testid="fc-preview-skeleton"
                role="status"
                aria-live="polite"
                aria-busy="true"
                aria-atomic="true"
                aria-label="预览启动中"
              >
                <div className="h-10 w-full animate-pulse rounded-lg bg-slate-200/80" />
                <div className="flex flex-1 gap-3">
                  <div className="hidden w-40 animate-pulse rounded-lg bg-slate-200/70 lg:block" />
                  <div className="flex-1 space-y-2.5">
                    <div className="h-6 w-1/2 animate-pulse rounded bg-slate-200/80" />
                    <div className="h-32 w-full animate-pulse rounded-lg bg-slate-100/80" />
                    <div className="h-32 w-full animate-pulse rounded-lg bg-slate-100/80" />
                  </div>
                </div>
                <p className="mt-2 text-center text-xs text-slate-400">⏳ 正在启动预览服务…</p>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <p className="text-4xl">🔍</p>
                  <p className="mt-3 text-sm text-slate-500">{error || '预览未就绪'}</p>
                  <p className="mt-1 text-xs text-slate-400">确认需求并完成开发后，这里会显示您的应用</p>
                </div>
                {status === 'error' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void retryPreview()}
                      className="rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-hover"
                    >
                      🔄 重试预览
                    </button>
                    <button
                      type="button"
                      onClick={openExternal}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100"
                    >
                      🌐 用浏览器打开
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {/* v3.2.1 P1-1：自研确认弹窗替代 window.confirm */}
      <ConfirmDialog
        open={confirmConvertOpen}
        title="确认切换到本地模式？"
        description={
          '将删除登录功能并改为本地存储。\n\n' +
          '• 会清空当前版本计划\n' +
          '• 需要重新生成代码与版本计划\n' +
          '• 之前的用户数据会被忽略'
        }
        confirmLabel="确认切换"
        cancelLabel="先不切换"
        tone="danger"
        confirming={converting}
        onCancel={() => setConfirmConvertOpen(false)}
        onConfirm={() => void doConvertToLocalMode()}
      />
    </div>
  );
}
