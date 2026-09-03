import { app, ipcMain, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { IpcChannels } from '../../shared/types/ipc';
import type { AppInfo } from '../../shared/types/app';
import { handleIpc } from './helpers';

/** 应用域 IPC（API 文档 4.7）。
 *  v0.1.03 起 dsh 状态由 `registerDshIpc` 独立负责（dsh:state / dsh:state-change），
 *  这里不再每调用都走 checkHealth。AppInfo 仅保留版本/平台/Electron 三项。
 */
export function registerAppIpc(): void {
  handleIpc<undefined, AppInfo>(IpcChannels.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron ?? '',
  }));

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
      // v3.2.1 P1-12：展开 `~/` 到用户主目录——shell.showItemInFolder 在 macOS / Linux 上
      // 不会自动解析波浪号，会把字面 "~/" 当成相对路径，弹错。
      const expanded = target.startsWith('~/')
        ? path.join(os.homedir(), target.slice(2))
        : target;
      try {
        shell.showItemInFolder(expanded);
        return { success: true };
      } catch {
        // fallback：父目录存在就 openPath
        try {
          const parent = path.dirname(expanded);
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
