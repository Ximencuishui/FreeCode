export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
}

/**
 * preload 暴露到渲染进程的全局 API。
 * 完整类型定义（21 个 IPC 通道）在 WP-03 按 API 接口设计文档补齐。
 */
declare global {
  interface Window {
    electron: {
      app: {
        getInfo: () => Promise<AppInfo>;
        quit: () => void;
      };
    };
  }
}
