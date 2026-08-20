import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels } from '../shared/types/ipc';

/** 订阅主进程事件推送，返回取消订阅函数 */
function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

/**
 * 暴露给渲染进程的安全 API（白名单，23 个通道）。
 * 类型见 src/shared/types/electron.d.ts（与 API 接口设计文档一致）。
 */
const electronApi: Window['electron'] = {
  chat: {
    send: (params) => ipcRenderer.invoke(IpcChannels.chatSend, params),
    onResponse: (callback) => subscribe(IpcChannels.chatResponse, callback),
    onSignal: (callback) => subscribe(IpcChannels.chatSignal, callback),
    getHistory: (params) => ipcRenderer.invoke(IpcChannels.chatHistory, params),
  },
  preview: {
    start: (params) => ipcRenderer.invoke(IpcChannels.previewStart, params),
    stop: () => ipcRenderer.invoke(IpcChannels.previewStop),
    refresh: () => ipcRenderer.invoke(IpcChannels.previewRefresh),
    onStatus: (callback) => subscribe(IpcChannels.previewStatus, callback),
    selectElement: (params) => ipcRenderer.invoke(IpcChannels.previewElement, params),
  },
  project: {
    list: () => ipcRenderer.invoke(IpcChannels.projectList),
    create: (params) => ipcRenderer.invoke(IpcChannels.projectCreate, params),
    delete: (params) => ipcRenderer.invoke(IpcChannels.projectDelete, params),
    get: (params) => ipcRenderer.invoke(IpcChannels.projectGet, params),
    confirm: (params) => ipcRenderer.invoke(IpcChannels.projectConfirm, params),
    selectLocation: () => ipcRenderer.invoke(IpcChannels.projectSelectLocation),
  },
  export: {
    start: (params) => ipcRenderer.invoke(IpcChannels.exportStart, params),
    onComplete: (callback) => subscribe(IpcChannels.exportComplete, callback),
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (params) => ipcRenderer.invoke(IpcChannels.settingsUpdate, params),
  },
  apikey: {
    save: (params) => ipcRenderer.invoke(IpcChannels.apiKeySave, params),
    validate: (params) => ipcRenderer.invoke(IpcChannels.apiKeyValidate, params),
  },
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.appInfo),
    quit: () => ipcRenderer.send(IpcChannels.appQuit),
    openExternal: (url) => ipcRenderer.invoke(IpcChannels.appOpenExternal, { url }),
  },
};

contextBridge.exposeInMainWorld('electron', electronApi);
