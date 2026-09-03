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
 * 暴露给渲染进程的安全 API（白名单，IPC 通道）。
 * 类型见 src/shared/types/electron.d.ts（与 API 接口设计文档一致）。
 */
const electronApi: Window['electron'] = {
  chat: {
    send: (params) => ipcRenderer.invoke(IpcChannels.chatSend, params),
    stop: (params) => ipcRenderer.invoke(IpcChannels.chatStop, params),
    onResponse: (callback) => subscribe(IpcChannels.chatResponse, callback),
    onSignal: (callback) => subscribe(IpcChannels.chatSignal, callback),
    getHistory: (params) => ipcRenderer.invoke(IpcChannels.chatHistory, params),
  },
  preview: {
    start: (params) => ipcRenderer.invoke(IpcChannels.previewStart, params),
    stop: () => ipcRenderer.invoke(IpcChannels.previewStop),
    refresh: () => ipcRenderer.invoke(IpcChannels.previewRefresh),
    openExternal: () => ipcRenderer.invoke(IpcChannels.previewOpenExternal),
    onStatus: (callback) => subscribe(IpcChannels.previewStatus, callback),
    selectElement: (params) => ipcRenderer.invoke(IpcChannels.previewElement, params),
  },
  project: {
    list: () => ipcRenderer.invoke(IpcChannels.projectList),
    create: (params) => ipcRenderer.invoke(IpcChannels.projectCreate, params),
    delete: (params) => ipcRenderer.invoke(IpcChannels.projectDelete, params),
    get: (params) => ipcRenderer.invoke(IpcChannels.projectGet, params),
    confirm: (params) => ipcRenderer.invoke(IpcChannels.projectConfirm, params),
    confirmPlan: (params) => ipcRenderer.invoke(IpcChannels.projectConfirmPlan, params),
    selectLocation: () => ipcRenderer.invoke(IpcChannels.projectSelectLocation),
    updateRequirements: (params) =>
      ipcRenderer.invoke(IpcChannels.projectUpdateRequirements, params),
    resumeDevelopment: (params) =>
      ipcRenderer.invoke(IpcChannels.projectResumeDevelopment, params),
    autoTest: (params) => ipcRenderer.invoke(IpcChannels.projectAutoTest, params),
    convertToLocalMode: (params) =>
      ipcRenderer.invoke(IpcChannels.projectConvertToLocalMode, params),
    listDocuments: (params) => ipcRenderer.invoke(IpcChannels.projectListDocuments, params),
    readDocument: (params) => ipcRenderer.invoke(IpcChannels.projectReadDocument, params),
    openAsset: (params) => ipcRenderer.invoke(IpcChannels.projectOpenAsset, params),
    // v3.2.2 P0-5：取消指定项目的开发任务（切项目时由前端调用，避免旧项目 AI 继续烧 token）
    cancelDevelopment: (params) =>
      ipcRenderer.invoke(IpcChannels.projectCancelDevelopment, params),
  },
  export: {
    start: (params) => ipcRenderer.invoke(IpcChannels.exportStart, params),
    // v3.2.2 P0-5：取消指定项目的导出任务（切项目时由前端调用，避免旧项目导出继续消耗 CPU/磁盘）
    cancel: (params) => ipcRenderer.invoke(IpcChannels.exportCancel, params),
    onComplete: (callback) => subscribe(IpcChannels.exportComplete, callback),
  },
  package: {
    start: (params) => ipcRenderer.invoke(IpcChannels.packageStart, params),
    // v3.2.2 P0-5：取消指定项目的打包任务（切项目时由前端调用）
    cancel: (params) => ipcRenderer.invoke(IpcChannels.packageCancel, params),
    onProgress: (callback) => subscribe(IpcChannels.packageProgress, callback),
    onComplete: (callback) => subscribe(IpcChannels.packageComplete, callback),
  },
  db: {
    provision: (params) => ipcRenderer.invoke(IpcChannels.dbProvision, params),
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (params) => ipcRenderer.invoke(IpcChannels.settingsUpdate, params),
  },
  apikey: {
    save: (params) => ipcRenderer.invoke(IpcChannels.apiKeySave, params),
    validate: (params) => ipcRenderer.invoke(IpcChannels.apiKeyValidate, params),
    test: (params) => ipcRenderer.invoke(IpcChannels.apiKeyTest, params),
  },
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.appInfo),
    quit: () => ipcRenderer.send(IpcChannels.appQuit),
    openExternal: (url) => ipcRenderer.invoke(IpcChannels.appOpenExternal, { url }),
    revealInFolder: (path) => ipcRenderer.invoke(IpcChannels.appRevealInFolder, { path }),
  },
};

contextBridge.exposeInMainWorld('electron', electronApi);
