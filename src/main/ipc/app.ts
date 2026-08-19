import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/types/ipc';
import type { AppInfo } from '../../shared/types/app';
import { handleIpc } from './helpers';

/** 应用域 IPC（API 文档 4.7） */
export function registerAppIpc(): void {
  handleIpc<undefined, AppInfo>(IpcChannels.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron ?? '',
  }));

  ipcMain.on(IpcChannels.appQuit, () => {
    // TODO(WP-07): 退出前先停止 DSH 子进程
    app.quit();
  });
}
