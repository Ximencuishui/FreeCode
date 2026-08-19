import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { createAppMenu } from './menu';
import { registerIpcHandlers } from './ipc';

app.whenReady().then(() => {
  registerIpcHandlers();
  createAppMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
