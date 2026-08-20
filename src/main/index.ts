import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { createAppMenu } from './menu';
import { registerIpcHandlers } from './ipc';
import { FileStorageManager, getFreeCoderDir } from './storage';
import { createSafeStorageEncryptor } from './security/electronEncryptor';
import { DSHService } from './dsh/service';
import { Developer } from './dev/developer';

app.whenReady().then(async () => {
  // 初始化本地存储（~/.freecoder/，API Key 使用 safeStorage 加密）
  const storage = new FileStorageManager(getFreeCoderDir(), createSafeStorageEncryptor());
  await storage.init();

  // DSH 服务：按需启动 headless 子进程执行任务（命令可经 FREECODER_DSH_COMMAND 覆盖）
  const dsh = new DSHService();
  const developer = new Developer({ storage, dsh });

  registerIpcHandlers(storage, dsh, developer);
  createAppMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
