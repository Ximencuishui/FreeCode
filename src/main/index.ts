import { app, BrowserWindow } from 'electron';
import { createMainWindow, registerClipboardShortcuts } from './window';
import { installAppMenu } from './menu';
import { registerIpcHandlers } from './ipc';
import { FileStorageManager, getFreeCoderDir } from './storage';
import { createSafeStorageEncryptor } from './security/electronEncryptor';
import { DSHService } from './dsh/service';
import { Developer } from './dev/developer';
import { VersionPlanner } from './dev/planner';

app.whenReady().then(async () => {
  // 初始化本地存储（~/.freecoder/，API Key 使用 safeStorage 加密）
  const storage = new FileStorageManager(getFreeCoderDir(), createSafeStorageEncryptor());
  await storage.init();

  // DSH 服务：按需启动 headless 子进程执行任务（命令可经 FREECODER_DSH_COMMAND 覆盖）
  // 大模型凭据以环境变量注入子进程（provider 的 apiKeyEnv 字段），key 来自本地加密存储
  const dsh = new DSHService({
    apiKeyProvider: async () => {
      const key = await storage.loadApiKey();
      if (!key) return null;
      const settings = await storage.getSettings();
      return {
        apiKey: key,
        provider: settings.provider === 'openai-compatible' ? 'openai-compatible' : 'deepseek',
        baseUrl: settings.baseUrl,
        model: settings.model,
      };
    },
  });
  const developer = new Developer({ storage, dsh });
  const planner = new VersionPlanner({ storage, dsh });

  registerIpcHandlers(storage, dsh, developer, planner);
  installAppMenu();
  registerClipboardShortcuts(); // 在创建窗口前注册，覆盖主窗口与 webview
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
