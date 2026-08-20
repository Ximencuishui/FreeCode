import { useEffect, useRef, useState } from 'react';
import type { PreviewStatus, ElementInfo, ElementSelectResult } from '@shared/types/preview';
import { useProjectStore } from '../../store/project';
import { useChatStore } from '../../store/chat';
import PreviewToolbar from './PreviewToolbar';

/** 预览视图：内嵌 WebView 显示生成的应用，支持元素悬停识别（前端设计说明书 3.3） */
export default function PreviewContainer() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const [url, setUrl] = useState<string | null>(null);
  const [inspectorPath, setInspectorPath] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>('stopped');
  const [error, setError] = useState('');
  const webviewRef = useRef<HTMLElement | null>(null);

  const reload = () => {
    const wv = webviewRef.current as unknown as { reload: () => void } | null;
    wv?.reload();
  };

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
      return;
    }

    // 先注册状态订阅（const），再启动预览
    const unsub = window.electron.preview.onStatus((e) => {
      setStatus(e.status);
      if (e.url) setUrl(e.url);
      if (e.reload) reload();
      if (e.status === 'error' && e.message) setError(e.message);
    });

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
  }, [currentProjectId]);

  const openExternal = () => {
    if (url) window.open(url, '_blank');
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <PreviewToolbar
        url={url}
        status={status}
        onRefresh={reload}
        onOpenExternal={openExternal}
      />
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
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-4xl">🔍</p>
              <p className="mt-3 text-sm text-slate-500">{error || '预览未就绪'}</p>
              <p className="mt-1 text-xs text-slate-400">确认需求并完成开发后，这里会显示您的应用</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
