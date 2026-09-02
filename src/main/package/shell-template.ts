/**
 * Electron 壳工程模板（智能打包用）。
 * 把用户的 web 项目代码 + 这个壳 = 一个可双击运行的桌面端应用。
 *
 * 设计原则：
 * - 不依赖任何用户项目结构（不强求 sql.js / 后端），纯前端项目也能打包
 * - 通过 file:// 协议加载用户项目里的 index.html（vite 输出的 SPA 根）
 * - 窗口尺寸、菜单、安全策略都在壳里写死，用户无需配置
 * - 壳里的 main.js / preload.js / package.json 由本服务在打包前动态写入临时目录
 */

export interface ShellContext {
  /** 应用名（用于窗口标题、产品名） */
  appName: string;
  /** electron-builder appId，必须是合法的 reverse-DNS 字符串 */
  appId: string;
  /** 项目内的入口 HTML 文件名，默认 index.html */
  entryHtml: string;
  /** 用户项目目录绝对路径（壳的 main.js 通过 file:// 加载它） */
  userProjectPath: string;
  /** 应用版本号（来自项目 / 自由指定） */
  version: string;
}

/**
 * 生成 electron 壳工程的 main.js。
 * 关键点：
 * - 关闭 nodeIntegration，启用 contextIsolation
 * - 通过 file:// 直接加载用户项目的入口 HTML（不需要本地 server）
 * - 拦截 window.open 走系统浏览器
 */
export function renderShellMain(ctx: ShellContext): string {
  // 注意：模板里的 ${...} 由 renderShellMain 调用方通过普通字符串拼接注入，
  // 这里只用 JS 字面量，不引入额外模板引擎，方便调试。
  return `// FreeCoder 自动生成 - electron 壳工程入口
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');

const USER_PROJECT_PATH = ${JSON.stringify(ctx.userProjectPath)};
const ENTRY_HTML = ${JSON.stringify(ctx.entryHtml)};
const APP_NAME = ${JSON.stringify(ctx.appName)};

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 允许用户项目里相对路径资源加载（DSH 产物常常自包含 data/*.json 等）
      webSecurity: true,
    },
  });

  const indexPath = path.join(USER_PROJECT_PATH, ENTRY_HTML);
  mainWindow.loadFile(indexPath).catch((err) => {
    console.error('[shell] loadFile failed:', err);
  });

  // 拦截 window.open：用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 应用菜单：去掉默认的 view > toggle devtools（避免误触发），保留必要项
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]),
  );

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`;
}

/**
 * 生成 electron 壳工程的 package.json（含 electron-builder 配置）。
 * 直接复用本仓库 electron-builder.yml 的同款设置（electronDist / npmRebuild / targets），
 * 避免从 GitHub CDN 拉 electron zip 国内网络超时。
 */
export function renderShellPackageJson(ctx: ShellContext): string {
  const pkg = {
    name: ctx.appId.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'freecoder-app',
    version: ctx.version,
    description: `FreeCoder 智能打包 - ${ctx.appName}`,
    main: 'main.js',
    private: true,
    scripts: {
      start: 'electron .',
    },
    devDependencies: {
      electron: '^43',
    },
    build: {
      appId: ctx.appId,
      productName: ctx.appName,
      // 使用本仓库 node_modules 里已安装的 Electron 发行版，避免从 GitHub CDN 拉 zip
      electronDist: 'node_modules/electron/dist',
      // 应用无原生依赖，跳过 @electron/rebuild
      npmRebuild: false,
      directories: {
        output: 'release',
      },
      files: [
        'main.js',
        'package.json',
        // 用户项目代码：以 app/ 子目录整体打包（详见 PackagerService.copyUserApp）
        'app/**/*',
      ],
      win: {
        target: [{ target: 'nsis' }, { target: 'portable' }],
        icon: undefined,
      },
      mac: {
        target: [{ target: 'dmg' }, { target: 'zip' }],
        category: 'public.app-category.productivity',
      },
      linux: {
        target: [{ target: 'AppImage' }],
        category: 'Office',
      },
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}