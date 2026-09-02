import { app, ipcMain, shell } from 'electron';
import path from 'node:path';
import { IpcChannels } from '../../shared/types/ipc';
import type { AppInfo } from '../../shared/types/app';
import type { DSHService } from '../dsh/service';
import { handleIpc } from './helpers';

/** 应用域 IPC（API 文档 4.7） */
export function registerAppIpc(dsh?: DSHService): void {
  handleIpc<undefined, AppInfo>(IpcChannels.appInfo, () => {
    const health = dsh?.checkHealth();
    return {
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron ?? '',
      dshAvailable: health?.available,
      dshHint: health?.message,
    };
  });

  // 用系统浏览器打开外部链接（白名单仅允许 http/https，用于"如何获取 API Key"等）
  handleIpc<{ url: string }, { success: boolean }>(
    IpcChannels.appOpenExternal,
    async (_event, params) => {
      const url = params?.url;
      if (!url || !/^https?:\/\//i.test(url)) {
        return { success: false };
      }
      await shell.openExternal(url);
      return { success: true };
    },
  );

  /**
   * 在系统文件管理器中高亮显示本地文件（shell.showItemInFolder）。
   * 用于部署/打包完成后打开产物所在目录，让用户立刻看到 .exe / zip 等。
   * 不做严格路径白名单：本地应用向自己产生的文件打开目录是常规用法。
   */
  handleIpc<{ path: string }, { success: boolean }>(
    IpcChannels.appRevealInFolder,
    async (_event, params) => {
      const target = params?.path;
      if (!target || typeof target !== 'string') {
        return { success: false };
      }
      try {
        shell.showItemInFolder(target);
        return { success: true };
      } catch {
        // fallback：父目录存在就 openPath
        try {
          const parent = path.dirname(target);
          await shell.openPath(parent);
          return { success: true };
        } catch {
          return { success: false };
        }
      }
    },
  );

  ipcMain.on(IpcChannels.appQuit, () => {
    app.quit();
  });
}
