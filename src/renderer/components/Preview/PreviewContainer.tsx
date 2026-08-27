import { useEffect, useRef, useState, useCallback } from 'react';
import type { PreviewStatus, ElementInfo, ElementSelectResult } from '@shared/types/preview';
import { useProjectStore } from '../../store/project';
import { useChatStore } from '../../store/chat';
import { useUiStore } from '../../store/ui';
import PreviewToolbar from './PreviewToolbar';

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

  /** 转本地模式：调主进程 IPC，成功后通知父组件（App 负责切视图 + 刷新状态） */
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const convertToLocalMode = useCallback(async () => {
    if (!currentProjectId || converting) return;
    const ok = window.confirm(
      '将删除登录功能并改为本地存储（需要重新生成代码）。继续？',
    );
    if (!ok) return;
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
      // 成功：刷新项目状态（状态已变为 planned），由 App 侧的 useEffect 自然推升到对话视图
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
            useChatStore.getState().setVersionPlan(r.project.versionPlan ?? null);
          }
        } catch {
          /* 刷新失败不影响主流程 */
        }
      }
      // 状态已变为 planned → 自动切到对话页让用户看到「确认 V1 计划，开始开发」卡
      useUiStore.getState().setView('chat');
      setConverting(false);
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : '转本地模式失败');
      setConverting(false);
    }
  }, [currentProjectId, converting]);

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
      {/* 转本地模式出错时提示（仅登录模式可能出现） */}
      {convertError && !localMode && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          <span className="min-w-0 flex-1 truncate">⚠️ 转本地模式失败：{convertError}</span>
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
        {url && inspectorPath && status !== 'error' ? (
          <webview
            ref={webviewRef as never}
            src={url}
            preload={inspectorPath}
            className="h-full w-full"
            partition="persist:preview"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
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
          </div>
        )}
      </div>
    </div>
  );
}
