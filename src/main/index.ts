import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { createAppMenu } from './menu';
import { registerIpcHandlers } from './ipc';
import { FileStorageManager, getFreeCoderDir } from './storage';
import { createSafeStorageEncryptor } from './security/electronEncryptor';

app.whenReady().then(async () => {
  // 初始化本地存储（~/.freecoder/，API Key 使用 safeStorage 加密）
  const storage = new FileStorageManager(getFreeCoderDir(), createSafeStorageEncryptor());
  await storage.init();

  registerIpcHandlers(storage);
  createAppMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
