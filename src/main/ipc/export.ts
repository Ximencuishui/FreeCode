import { BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/types/ipc';
import type { ExportStartParams, ExportStartResult, ExportCompleteEvent } from '../../shared/types/export';
import type { StorageManager } from '../storage/types';
import { ExportService } from '../export/service';
import { handleIpc, IpcError } from './helpers';

/** 向所有窗口推送 export:complete 事件 */
function broadcastComplete(event: ExportCompleteEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.exportComplete, event);
  }
}

/**
 * 导出域 IPC（API 文档 4.4）。
 * 导出在后台执行，完成后推送 export:complete。
 */
export function registerExportIpc(storage: StorageManager): void {
  const exporter = new ExportService(storage);

  handleIpc<ExportStartParams, ExportStartResult>(IpcChannels.exportStart, async (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    const project = await storage.getProject(params.projectId);
    if (!project) {
      throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
    }
    if (project.status !== 'ready' && project.status !== 'exported') {
      throw new IpcError('INVALID_PARAMS', '项目尚未开发完成，无法导出');
    }

    // 生成任务 ID，后台执行导出
    const exportId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
    void exporter
      .exportProject(params.projectId, {
        includeDocker: params.includeDocker ?? true,
        config: params.config,
      })
      .then((result) => {
        broadcastComplete({
          exportId: result.exportId,
          status: 'success',
          zipPath: result.zipPath,
        });
      })
      .catch((err) => {
        broadcastComplete({
          exportId,
          status: 'failed',
          error: err instanceof Error ? err.message : '导出失败',
        });
      });

    return { success: true, exportId };
  });
}
