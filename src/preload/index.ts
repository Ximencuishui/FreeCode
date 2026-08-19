import { contextBridge, ipcRenderer } from 'electron';

const electronApi = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:info'),
    quit: () => ipcRenderer.send('app:quit'),
  },
} as const;

contextBridge.exposeInMainWorld('electron', electronApi);
