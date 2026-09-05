import { BrowserWindow, app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { IpcChannels } from '../../shared/types/ipc';
import type {
  PreviewStartParams,
  PreviewStartResult,
  PreviewStopResult,
  PreviewStatusEvent,
  PreviewInspectorChangedEvent,
  ElementSelectParams,
  ElementSelectResult,
  PreviewRefreshResult,
  PreviewOpenExternalResult,
} from '../../shared/types/preview';
import type { StorageManager } from '../storage/types';
import { PreviewServer } from '../preview/server';
import { describeElement } from '../preview/inspector';
import { ensureAuthRuntime } from '../dev/runtime';
import { handleIpc, IpcError } from './helpers';

/** 向所有窗口推送 preview:status 事件 */
function broadcastStatus(status: PreviewStatusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.previewStatus, status);
  }
}

/** dev 模式专用：向所有窗口广播 inspector.js 变更事件 */
function broadcastInspectorChanged(event: PreviewInspectorChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.previewInspectorChanged, event);
  }
}

/**
 * dev 模式专用：watch resources/preview/inspector.js 文件变更，
 * 文件被改 → 广播 preview:inspector-changed → 渲染端 webview.reload() 拉取最新 preload。
 * Vite HMR 只能感知 src/ 内的渲染层代码，webview preload 在 src/ 之外且由 webview 启动时一次性加载，
 * 不监听的话开发体验会断裂（用户改了 preload 不知道要点刷新）。
 *
 * 注意：生产打包后 inspector.js 被固化为只读资源，不再监听。
 */
let inspectorWatcher: fs.FSWatcher | null = null;
let inspectorWatchDebounce: NodeJS.Timeout | null = null;
function startInspectorWatcher(): void {
  if (inspectorWatcher) return;
  if (app.isPackaged) return;
  const inspectorFile = getInspectorPath();
  try {
    const stat = fs.statSync(inspectorFile);
    let lastMtimeMs = stat.mtimeMs;
    inspectorWatcher = fs.watch(inspectorFile, () => {
      // 编辑器原子保存（写 .tmp → rename）可能触发多次 change，去抖后只取最新一次
      if (inspectorWatchDebounce) clearTimeout(inspectorWatchDebounce);
      inspectorWatchDebounce = setTimeout(() => {
        try {
          const next = fs.statSync(inspectorFile);
          if (next.mtimeMs === lastMtimeMs) return;
          lastMtimeMs = next.mtimeMs;
          console.log(
            `[preview] inspector.js changed (mtime=${next.mtimeMs}), broadcasting reload hint`,
          );
          broadcastInspectorChanged({
            mtimeMs: next.mtimeMs,
            inspectorPath: inspectorFile,
          });
        } catch (err) {
          console.warn('[preview] inspector watcher stat failed:', err);
        }
      }, 80);
    });
    inspectorWatcher.on('error', (err) => {
      console.warn('[preview] inspector watcher error:', err);
    });
    console.log('[preview] inspector watcher started:', inspectorFile);
  } catch (err) {
    console.warn('[preview] inspector watcher start failed:', err);
  }
}

/**
 * 预览域 IPC（API 文档 4.2），基于本地预览服务器实现。
 * 元素选中（悬停识别）在 WP-15 落地。
 */
export function registerPreviewIpc(storage: StorageManager): void {
  const server = new PreviewServer();

  // dev 模式：监听 inspector.js 文件变更，触发渲染端 webview 重载
  startInspectorWatcher();

  // 文件变更 → 热加载通知
  server.on('file-change', () => {
    broadcastStatus({ status: 'running', message: '文件已更新，刷新预览', reload: true });
  });

  handleIpc<PreviewStartParams, PreviewStartResult>(
    IpcChannels.previewStart,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      if (server.isRunning()) {
        // 幂等：已在运行时直接返回当前预览地址
        const port = server.getPort();
        return {
          success: true,
          url: `http://localhost:${port}`,
          port: port ?? undefined,
          inspectorPath: getInspectorPath(),
        };
      }

      broadcastStatus({ status: 'starting', message: '正在启动预览…' });
      try {
        const codePath = storage.getProjectCodePath(params.projectId);
        // 自愈：老项目/异常中断导致缺少登录运行时（auth.js/server.js）时自动补齐，
        // 否则页面加载 auth.js 404 → app.js 崩溃 → 白屏打不开。
        await ensureAuthRuntime(codePath);
        const info = await server.start(codePath);
        await storage.updateProjectMeta(params.projectId, { previewPort: info.port });
        broadcastStatus({ status: 'running', url: info.url });
        return {
          success: true,
          url: info.url,
          port: info.port,
          inspectorPath: getInspectorPath(),
        };
      } catch (err) {
        broadcastStatus({ status: 'error', message: '预览启动失败' });
        throw err;
      }
    },
  );

  handleIpc<undefined, PreviewStopResult>(IpcChannels.previewStop, async () => {
    if (!server.isRunning()) {
      throw new IpcError('PREVIEW_NOT_RUNNING', '预览尚未启动');
    }
    await server.stop();
    broadcastStatus({ status: 'stopped' });
    return { success: true };
  });

  handleIpc<undefined, PreviewRefreshResult>(IpcChannels.previewRefresh, async () => {
    if (!server.isRunning()) {
      throw new IpcError('PREVIEW_NOT_RUNNING', '预览尚未启动');
    }
    broadcastStatus({ status: 'running', reload: true });
    return { success: true };
  });

  // 用系统浏览器打开当前预览（真实测试不受元素选择干扰）
  handleIpc<undefined, PreviewOpenExternalResult>(IpcChannels.previewOpenExternal, async () => {
    if (!server.isRunning()) {
      throw new IpcError('PREVIEW_NOT_RUNNING', '预览尚未启动，无法在浏览器中打开');
    }
    const port = server.getPort();
    const url = `http://localhost:${port}`;
    await shell.openExternal(url);
    return { success: true, url };
  });

  handleIpc<ElementSelectParams, ElementSelectResult>(
    IpcChannels.previewElement,
    (_event, params) => {
      if (!params?.element) {
        throw new IpcError('INVALID_PARAMS', '元素信息不能为空');
      }
      return { success: true, elementInfo: describeElement(params.element) };
    },
  );
}

/** webview 元素检查器 preload 路径（随应用分发，打包后位于 resources/preview/） */
function getInspectorPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'preview', 'inspector.js');
  }
  return path.join(app.getAppPath(), 'resources', 'preview', 'inspector.js');
}
