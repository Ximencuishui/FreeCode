import { useEffect, useRef, useState } from 'react';
import type { PreviewStatus } from '@shared/types/preview';
import { useProjectStore } from '../../store/project';
import PreviewToolbar from './PreviewToolbar';

/** 预览视图：内嵌 WebView 显示生成的应用（前端设计说明书 3.3） */
export default function PreviewContainer() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>('stopped');
  const [error, setError] = useState('');
  const webviewRef = useRef<HTMLElement | null>(null);

  const reload = () => {
    const wv = webviewRef.current as unknown as { reload: () => void } | null;
    wv?.reload();
  };

  useEffect(() => {
    if (!currentProjectId) {
      setUrl(null);
      setStatus('stopped');
      return;
    }

    let unsub: (() => void) | undefined = undefined;

    window.electron.preview
      .start({ projectId: currentProjectId })
      .then((r) => {
        if (r.success && r.url) {
          setUrl(r.url);
          setStatus('running');
          setError('');
        } else {
          setError(r.error ?? '预览启动失败');
        }
      })
      .catch((err) => {
        const msg =
          (err && typeof err === 'object' && 'error' in err
            ? String((err as { error: { message: string } }).error.message)
            : undefined) ?? '预览启动失败';
        setError(msg);
      });

    unsub = window.electron.preview.onStatus((e) => {
      setStatus(e.status);
      if (e.url) setUrl(e.url);
      if (e.reload) reload();
      if (e.status === 'error' && e.message) setError(e.message);
    });

    return () => {
      unsub?.();
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
        {url && status !== 'error' ? (
          <webview
            ref={webviewRef as never}
            src={url}
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
