import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { IpcChannels } from '../../shared/types/ipc';
import type {
  PreviewStartParams,
  PreviewStartResult,
  PreviewStopResult,
  PreviewStatusEvent,
  ElementSelectParams,
  ElementSelectResult,
  PreviewRefreshResult,
} from '../../shared/types/preview';
import type { StorageManager } from '../storage/types';
import { PreviewServer } from '../preview/server';
import { describeElement } from '../preview/inspector';
import { handleIpc, IpcError } from './helpers';

/** 向所有窗口推送 preview:status 事件 */
function broadcastStatus(status: PreviewStatusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.previewStatus, status);
  }
}

/**
 * 预览域 IPC（API 文档 4.2），基于本地预览服务器实现。
 * 元素选中（悬停识别）在 WP-15 落地。
 */
export function registerPreviewIpc(storage: StorageManager): void {
  const server = new PreviewServer();

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
        const info = await server.start(storage.getProjectCodePath(params.projectId));
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
