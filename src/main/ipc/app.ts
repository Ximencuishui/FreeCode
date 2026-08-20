import { app, ipcMain, shell } from 'electron';
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

  // 用系统浏览器打开外部链接（白名单仅允许 http/https，用于"如何获取 API Key"等）
  handleIpc<{ url: string }, { success: boolean }>(IpcChannels.appOpenExternal, async (_event, params) => {
    const url = params?.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      return { success: false };
    }
    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.on(IpcChannels.appQuit, () => {
    // TODO(WP-07): 退出前先停止 DSH 子进程
    app.quit();
  });
}
