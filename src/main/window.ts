import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

/** 应用图标路径（打包后位于 resources/icons/，开发态位于仓库 resources/icons/） */
export function resolveAppIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icons', 'icon.png');
  }
  return path.join(app.getAppPath(), 'resources', 'icons', 'icon.png');
}

/**
 * 恢复菜单移除后的常用剪贴板快捷键（Windows/Linux）。
 * 菜单被置空后 Electron 不再提供默认加速键，这里在输入事件层手动处理。
 * 通过 web-contents-created 注册，覆盖主窗口与 preview 的 webview guest
 * （否则去掉菜单后 webview 内的 Ctrl+C/V 也会失效）。
 */
export function registerClipboardShortcuts(): void {
  if (process.platform === 'darwin') return; // macOS 保留系统菜单，无需处理
  app.on('web-contents-created', (_event, contents) => {
    const type = contents.getType();
    if (type !== 'window' && type !== 'webview') return;
    contents.on('before-input-event', (event, input) => {
      if (!input.control || input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if (key === 'c') {
        contents.copy();
        event.preventDefault();
      } else if (key === 'x') {
        contents.cut();
        event.preventDefault();
      } else if (key === 'v') {
        contents.paste();
        event.preventDefault();
      } else if (key === 'a') {
        contents.selectAll();
        event.preventDefault();
      }
    });
  });
}

/** 创建主窗口（三栏式布局，见前端设计说明书 2.1） */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'FreeCoder',
    icon: resolveAppIconPath(),
    backgroundColor: '#FFFFFF',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  // 就绪后再显示，避免白屏闪烁
  win.once('ready-to-show', () => win.show());

  // 外部链接交给系统浏览器，不在应用内新开窗口（仅放行 http/https）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url).catch(() => undefined);
    }
    return { action: 'deny' };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../index.html'));
  }

  return win;
}
