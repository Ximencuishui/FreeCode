import { BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/types/ipc';
import type {
  PackageStartParams,
  PackageStartResult,
  PackageProgressEvent,
  PackageCompleteEvent,
} from '../../shared/types/package';
import type { StorageManager } from '../storage/types';
import { PackagerService } from '../package/service';
import { handleIpc, IpcError } from './helpers';

/** 向所有窗口推送 package:progress / package:complete 事件 */
function broadcastProgress(event: PackageProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.packageProgress, event);
  }
}
function broadcastComplete(event: PackageCompleteEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.packageComplete, event);
  }
}

/**
 * 智能打包域 IPC（API 文档 4.5）。
 * 启动后台打包任务；进度通过 package:progress 推送，完成通过 package:complete 推送。
 * 同类实例只允许一个并发任务，避免端口与磁盘竞争。
 */
export function registerPackageIpc(storage: StorageManager): void {
  const packager = new PackagerService(storage);

  handleIpc<PackageStartParams, PackageStartResult>(
    IpcChannels.packageStart,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      if (project.status !== 'ready' && project.status !== 'exported') {
        throw new IpcError('INVALID_PARAMS', '项目尚未开发完成，无法打包');
      }

      try {
        const { packageId } = await packager.start(params.projectId, {
          onProgress: broadcastProgress,
          onComplete: broadcastComplete,
        });
        return { success: true, packageId };
      } catch (err) {
        if (err instanceof IpcError) throw err;
        throw new IpcError(
          'EXPORT_FAILED',
          err instanceof Error ? err.message : '启动打包失败',
        );
      }
    },
  );

  // v3.2.2 P0-5：取消指定项目的打包任务（切项目时由前端调用）
  handleIpc<{ projectId: string }, { success: boolean; cancelled: boolean }>(
    IpcChannels.packageCancel,
    async (_event, params) => {
      const projectId = params?.projectId?.trim();
      if (!projectId) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const cancelled = packager.cancel(projectId);
      return { success: true, cancelled };
    },
  );
}