import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { createMainWindow, registerClipboardShortcuts } from './window';
import { installAppMenu } from './menu';
import { registerIpcHandlers } from './ipc';
import { FileStorageManager, getFreeCoderDir } from './storage';
import { createSafeStorageEncryptor } from './security/electronEncryptor';
import { DSHService } from './dsh/service';
import { ensureHeadlessRunnerPatched } from './dsh/patchRunner';
import { Developer } from './dev/developer';
import { VersionPlanner } from './dev/planner';

/**
 * 主进程兜底日志：任何未捕获异常/拒绝都记录到 ~/.freecoder/logs/error.log，
 * 而不是弹出原生 "Uncaught Exception" 崩溃弹窗。业务错误应在各自路径被捕获
 * 并以统一错误响应/弹窗呈现（如 API Key 缺失 → 配置弹窗）。
 */
function installErrorLogging(): void {
  const logDir = path.join(getFreeCoderDir(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'error.log');

  const write = (level: string, err: unknown) => {
    try {
      const detail =
        err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
      fs.appendFileSync(
        logFile,
        `[${new Date().toISOString()}] [${level}]\n${detail}\n${'-'.repeat(60)}\n`,
        'utf-8',
      );
    } catch {
      /* 日志写入失败时忽略，避免递归异常 */
    }
  };

  process.on('uncaughtException', (error) => {
    write('uncaughtException', error);
    console.error('[FreeCoder] uncaughtException:', error);
  });
  process.on('unhandledRejection', (reason) => {
    write('unhandledRejection', reason);
    console.error('[FreeCoder] unhandledRejection:', reason);
  });
}

installErrorLogging();

app.whenReady().then(async () => {
  // 初始化本地存储（~/.freecoder/，API Key 使用 safeStorage 加密）
  const storage = new FileStorageManager(getFreeCoderDir(), createSafeStorageEncryptor());
  await storage.init();

  // 幂等补丁：让 headless runner 输出推理过程（实时流 + 最终信封），供前端展示思考过程
  ensureHeadlessRunnerPatched();

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
