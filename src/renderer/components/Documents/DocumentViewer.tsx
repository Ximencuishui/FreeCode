import { useCallback, useEffect, useState } from 'react';
import type { ProjectDocumentReadResult, ProjectDocumentSummary } from '@shared/types/project';
import DocumentMarkdown from './DocumentMarkdown';
import { toFileUrl } from './fileUrl';
import {
  SplitButtonMenu,
  type SplitButtonMenuOption,
  type SplitButtonTone,
} from '../common/SplitButtonMenu';

interface DocumentViewerProps {
  projectId: string;
  selectedPath: string | null;
}

function getErrorMessage(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'message' in raw) {
    return String((raw as { message: unknown }).message);
  }
  return '无法读取文档';
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatModifiedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '更新时间未知';
  return `更新于 ${date.toLocaleDateString('zh-CN')}`;
}

/**
 * 透明背景检测网格的颜色由 src/renderer/index.css 中的 `.document-viewer-grid` 定义，
 * 通过 CSS 变量切换亮 / 暗两套棋盘格；这里只在容器上挂类名即可。
 * 适用于 PNG/WebP/AVIF/GIF/SVG 等可能含 alpha 通道的格式，方便观察 icon / logo 透明边缘。
 */
const TRANSPARENT_GRID_CLASS = 'document-viewer-grid';

type CopyState = 'idle' | 'copied' | 'error';

/** 复制路径的三种格式：相对路径 / 绝对路径 / Markdown 引用。选择会持久化到 localStorage。 */
type PathCopyMode = 'relative' | 'absolute' | 'markdown';

const PATH_COPY_MODES: ReadonlyArray<SplitButtonMenuOption<PathCopyMode>> = [
  { key: 'relative', label: '项目根相对', description: '例如 assets/logo.svg' },
  { key: 'absolute', label: '绝对路径', description: '例如 C:\\Users\\…\\assets\\logo.svg' },
  { key: 'markdown', label: 'Markdown 引用', description: '例如 ![logo.svg](./assets/logo.svg)' },
];

const PATH_COPY_MODE_KEY = 'freecoder.documentPathCopyMode';

function readStoredPathCopyMode(): PathCopyMode {
  try {
    const saved = localStorage.getItem(PATH_COPY_MODE_KEY);
    if (saved === 'relative' || saved === 'absolute' || saved === 'markdown') {
      return saved;
    }
  } catch {
    /* 隐私模式：忽略，使用默认值 */
  }
  return 'relative';
}

function formatPathForMode(
  mode: PathCopyMode,
  relativePath: string,
  absolutePath: string,
  fileName: string,
): string {
  switch (mode) {
    case 'relative':
      return relativePath;
    case 'absolute':
      return absolutePath;
    case 'markdown':
      return `![${fileName}](./${relativePath})`;
    default:
      return relativePath;
  }
}

/** SVG / 图片素材的快捷动作：交给系统默认应用打开 / 复制 file:// URL。选择会持久化到 localStorage。 */
type AssetOpenMode = 'open' | 'copy-file-url';

const ASSET_OPEN_MODES: ReadonlyArray<SplitButtonMenuOption<AssetOpenMode>> = [
  { key: 'open', label: '在浏览器打开', description: '调用 shell.openPath 交给系统默认应用', icon: '↗' },
  { key: 'copy-file-url', label: '复制 file:// URL', description: '把 file:///… 写入剪贴板', icon: '🔗' },
];

const ASSET_OPEN_MODE_KEY = 'freecoder.documentAssetOpenMode';

function readStoredAssetOpenMode(): AssetOpenMode {
  try {
    const saved = localStorage.getItem(ASSET_OPEN_MODE_KEY);
    if (saved === 'open' || saved === 'copy-file-url') {
      return saved;
    }
  } catch {
    /* 隐私模式：忽略，使用默认值 */
  }
  return 'open';
}

/** 把 data URL 写到系统剪贴板：优先写入二进制图片（可贴到微信/QQ/文档），失败时降级为文本 data URL。 */
async function copyImageAsset(
  assetSrc: string,
  mediaType: string,
): Promise<CopyState> {
  try {
    const response = await fetch(assetSrc);
    const blob = await response.blob();
    const mimeType = blob.type || mediaType || 'image/png';
    // 现代浏览器 / Electron 都支持 ClipboardItem；不支持时降级为文本
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
      return 'copied';
    }
  } catch {
    // 某些格式（ICO/SVG）在部分环境下 ClipboardItem 写入失败 → 走文本兜底
  }
  try {
    await navigator.clipboard.writeText(assetSrc);
    return 'copied';
  } catch {
    return 'error';
  }
}

/** 把任意字符串写入剪贴板（用于路径 / Markdown 引用等纯文本复制）。 */
async function copyText(text: string): Promise<CopyState> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'error';
  }
}

function DocumentHeader({ document }: { document: ProjectDocumentSummary }) {
  const isImage = document.kind === 'image';
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm" aria-hidden="true">
            {isImage ? '🖼️' : '📄'}
          </span>
          <h2 className="truncate text-sm font-semibold text-slate-800">{document.name}</h2>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
            {isImage ? '图片素材' : 'Markdown'}
          </span>
        </div>
        <p className="mt-1 truncate text-[10px] text-slate-400" title={document.relativePath}>
          {document.relativePath}
        </p>
      </div>
      <span className="shrink-0 text-[10px] text-slate-400">
        {formatModifiedAt(document.modifiedAt)} · {formatFileSize(document.size)}
      </span>
    </header>
  );
}

export default function DocumentViewer({ projectId, selectedPath }: DocumentViewerProps) {
  const [result, setResult] = useState<ProjectDocumentReadResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [pathCopyState, setPathCopyState] = useState<CopyState>('idle');
  const [pathCopyMode, setPathCopyMode] = useState<PathCopyMode>(readStoredPathCopyMode);
  const [assetOpenMode, setAssetOpenMode] = useState<AssetOpenMode>(readStoredAssetOpenMode);
  const [assetCopyState, setAssetCopyState] = useState<CopyState>('idle');
  const [openAssetError, setOpenAssetError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!selectedPath) {
      setResult(null);
      return () => {
        active = false;
      };
    }

    setResult(null);
    window.electron.project
      .readDocument({ projectId, relativePath: selectedPath })
      .then((readResult) => {
        if (active) setResult(readResult);
      })
      .catch(() => {
        if (active) setResult({ success: false, error: '无法连接本地文档服务' });
      });

    return () => {
      active = false;
    };
  }, [projectId, selectedPath, reloadKey]);

  /** 把当前路径格式写到 localStorage，让选择跨会话保留 */
  useEffect(() => {
    try {
      localStorage.setItem(PATH_COPY_MODE_KEY, pathCopyMode);
    } catch {
      /* 隐私模式：忽略 */
    }
  }, [pathCopyMode]);

  /** 把当前资产快捷动作写到 localStorage（"打开 / 复制 file:// URL"） */
  useEffect(() => {
    try {
      localStorage.setItem(ASSET_OPEN_MODE_KEY, assetOpenMode);
    } catch {
      /* 隐私模式：忽略 */
    }
  }, [assetOpenMode]);

  /** 复制图片到剪贴板：成功后 1.8s 自动复位按钮文案 */
  const handleCopyImage = useCallback(async () => {
    if (!result?.asset) return;
    const state = await copyImageAsset(result.asset.src, result.asset.mediaType);
    setCopyState(state);
    const timer = window.setTimeout(() => setCopyState('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [result]);

  /** 用当前选择的格式复制路径（默认沿用上次会话保存的模式） */
  const handleCopyPath = useCallback(
    async (modeOverride?: PathCopyMode) => {
      if (!result?.document || !result.absolutePath) return;
      const mode = modeOverride ?? pathCopyMode;
      const text = formatPathForMode(
        mode,
        result.document.relativePath,
        result.absolutePath,
        result.document.name,
      );
      const state = await copyText(text);
      setPathCopyState(state);
      const timer = window.setTimeout(() => setPathCopyState('idle'), 1800);
      return () => window.clearTimeout(timer);
    },
    [result, pathCopyMode],
  );

  /** 菜单中选择格式：更新当前模式 + 立即按新格式复制一次（一步完成切换） */
  const handleSelectMode = useCallback(
    async (mode: PathCopyMode) => {
      setPathCopyMode(mode);
      await handleCopyPath(mode);
    },
    [handleCopyPath],
  );

  /** 按当前模式执行图片素材快捷动作（"打开" 或 "复制 file:// URL"） */
  const handleAssetAction = useCallback(
    async (modeOverride?: AssetOpenMode) => {
      if (!result?.document || !result.absolutePath) return;
      const mode = modeOverride ?? assetOpenMode;
      setOpenAssetError(null);
      if (mode === 'copy-file-url') {
        const state = await copyText(toFileUrl(result.absolutePath));
        setAssetCopyState(state);
        const timer = window.setTimeout(() => setAssetCopyState('idle'), 1800);
        return () => window.clearTimeout(timer);
      }
      // 默认 'open'：调用主进程交给系统默认应用
      try {
        const openResult = await window.electron.project.openAsset({
          projectId,
          relativePath: result.document.relativePath,
        });
        if (!openResult.success) {
          setOpenAssetError(openResult.error ?? '无法用系统默认应用打开');
        }
      } catch (err) {
        setOpenAssetError(err instanceof Error ? err.message : '无法用系统默认应用打开');
      }
    },
    [projectId, result, assetOpenMode],
  );

  /** 菜单中选择动作模式：更新当前模式 + 立即执行一次 */
  const handleSelectAssetMode = useCallback(
    async (mode: AssetOpenMode) => {
      setAssetOpenMode(mode);
      await handleAssetAction(mode);
    },
    [handleAssetAction],
  );

  /** 切换文档 / 重载时复位复制按钮文案与打开错误，避免上一个素材的"已复制"或错误残留 */
  useEffect(() => {
    setCopyState('idle');
    setPathCopyState('idle');
    setAssetCopyState('idle');
    setOpenAssetError(null);
  }, [selectedPath, reloadKey]);

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50/50 p-8 text-center">
        <div>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-2xl">📚</div>
          <h2 className="mt-4 text-base font-semibold text-slate-700">从右侧目录选择一份文档</h2>
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-400">README、需求说明、技术文档、开发计划和图片素材都可以在这里查看。</p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50/50 text-sm text-slate-400" aria-live="polite">
        正在打开文档…
      </div>
    );
  }

  if (!result.success || !result.document) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50/50 p-8 text-center">
        <div>
          <div className="text-3xl">⚠️</div>
          <h2 className="mt-3 text-base font-semibold text-slate-700">文档暂时无法打开</h2>
          <p className="mt-2 text-xs text-slate-500">{getErrorMessage(result.error)}</p>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  const { document: currentDocument, asset, content } = result;
  // 把复制状态映射成 SplitButtonMenu 的色调，避免每个 button 都写一遍三元表达式
  const pathCopyTone: SplitButtonTone =
    pathCopyState === 'copied' ? 'success' : pathCopyState === 'error' ? 'error' : 'idle';
  const assetCopyTone: SplitButtonTone =
    assetCopyState === 'copied' ? 'success' : assetCopyState === 'error' ? 'error' : 'idle';
  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/30">
      <DocumentHeader document={currentDocument} />
      {currentDocument.kind === 'image' && asset ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex min-h-[420px] max-w-5xl flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {/* 棋盘格底：方便观察 PNG/WebP/SVG 等含透明区域的图标 / Logo 边缘（深色模式自动切换） */}
            <div
              className={`${TRANSPARENT_GRID_CLASS} flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl p-6`}
            >
              {/* 只渲染主进程返回的 data URL，不让文档直接访问本地文件系统 */}
              <img
                src={asset.src}
                alt={asset.alt}
                referrerPolicy="no-referrer"
                className="max-h-[65vh] max-w-full object-contain"
              />
            </div>
            <footer className="mt-4 flex w-full flex-col gap-2 text-xs text-slate-500">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="min-w-0 truncate" title={currentDocument.relativePath}>
                  {currentDocument.relativePath}
                </span>
                <span className="shrink-0">{formatFileSize(currentDocument.size)}</span>
              </div>
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {/* 复制路径：split button — 主区按当前模式复制，右侧 ▾ 切格式；选择持久化到 localStorage */}
                  <SplitButtonMenu<PathCopyMode>
                    value={pathCopyMode}
                    options={PATH_COPY_MODES}
                    onMainClick={() => void handleCopyPath()}
                    onSelect={(mode) => void handleSelectMode(mode)}
                    tone={pathCopyTone}
                    mainAriaLabel={
                      pathCopyState === 'copied'
                        ? '路径已复制到剪贴板'
                        : pathCopyState === 'error'
                          ? '复制失败，请重试'
                          : `按当前格式（${
                              PATH_COPY_MODES.find((m) => m.key === pathCopyMode)?.label ?? ''
                            }）复制路径`
                    }
                    toggleAriaLabel="切换复制路径格式"
                    renderMain={(active) => (
                      <>
                        <span aria-hidden="true">
                          {pathCopyState === 'copied'
                            ? '✓'
                            : pathCopyState === 'error'
                              ? '⚠'
                              : '📋'}
                        </span>
                        <span>
                          {pathCopyState === 'copied'
                            ? '已复制'
                            : pathCopyState === 'error'
                              ? '复制失败'
                              : `复制 · ${active.label}`}
                        </span>
                      </>
                    )}
                  />
                  {/* 图片素材快捷动作：split button — 主区按当前模式执行（打开 / 复制 file:// URL），右侧 ▾ 切换；选择持久化到 localStorage */}
                  <SplitButtonMenu<AssetOpenMode>
                    value={assetOpenMode}
                    options={ASSET_OPEN_MODES}
                    onMainClick={() => void handleAssetAction()}
                    onSelect={(mode) => void handleSelectAssetMode(mode)}
                    tone={assetCopyTone}
                    mainAriaLabel={
                      assetCopyState === 'copied'
                        ? 'file:// URL 已复制到剪贴板'
                        : assetCopyState === 'error'
                          ? '复制失败，请重试'
                          : ASSET_OPEN_MODES.find((m) => m.key === assetOpenMode)?.label ?? ''
                    }
                    toggleAriaLabel="切换图片素材快捷动作"
                    renderMain={(active) => (
                      <>
                        <span aria-hidden="true">
                          {assetCopyState === 'copied'
                            ? '✓'
                            : assetCopyState === 'error'
                              ? '⚠'
                              : active.icon}
                        </span>
                        <span>
                          {assetCopyState === 'copied'
                            ? 'URL 已复制'
                            : assetCopyState === 'error'
                              ? '复制失败'
                              : active.label}
                        </span>
                      </>
                    )}
                  />
                </div>
                {/* 主操作：复制图片到剪贴板（贴到微信/QQ/Office 直接是图） */}
                <button
                  type="button"
                  onClick={() => void handleCopyImage()}
                  aria-label={
                    copyState === 'copied'
                      ? '图片已复制到剪贴板'
                      : copyState === 'error'
                        ? '复制失败，请重试'
                        : '复制图片到剪贴板'
                  }
                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    copyState === 'copied'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                      : copyState === 'error'
                        ? 'border-rose-200 bg-rose-50 text-rose-600'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                  }`}
                >
                  <span aria-hidden="true">
                    {copyState === 'copied' ? '✓' : copyState === 'error' ? '⚠' : '⧉'}
                  </span>
                  <span>
                    {copyState === 'copied'
                      ? '已复制，可粘贴到 README / 微信'
                      : copyState === 'error'
                        ? '复制失败'
                        : '复制图片'}
                  </span>
                </button>
              </div>
              {openAssetError && (
                <p className="w-full text-[11px] text-rose-500">⚠ {openAssetError}</p>
              )}
            </footer>
          </div>
        </div>
      ) : (
        <article className="min-h-0 flex-1 overflow-y-auto px-6 py-7">
          <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white px-8 py-8 shadow-sm">
            <DocumentMarkdown content={content ?? ''} />
          </div>
        </article>
      )}
    </div>
  );
}
