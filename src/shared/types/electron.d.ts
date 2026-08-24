import type {
  ChatSendParams,
  ChatSendResult,
  ChatResponseEvent,
  SignalEvent,
  ChatHistoryParams,
  ChatHistoryResult,
} from './chat';
import type {
  PreviewStartParams,
  PreviewStartResult,
  PreviewStopResult,
  PreviewStatusEvent,
  ElementSelectParams,
  ElementSelectResult,
  PreviewRefreshResult,
} from './preview';
import type {
  ProjectListResult,
  ProjectCreateParams,
  ProjectCreateResult,
  ProjectDeleteParams,
  ProjectDeleteResult,
  ProjectGetParams,
  ProjectGetResult,
  ProjectConfirmParams,
  ProjectConfirmResult,
  ProjectConfirmPlanParams,
  ProjectConfirmPlanResult,
  ProjectSelectLocationResult,
} from './project';
import type { ExportStartParams, ExportStartResult, ExportCompleteEvent } from './export';
import type {
  DbProvisionParams,
  DbProvisionResult,
} from './dbprovision';
import type {
  SettingsGetResult,
  SettingsUpdateParams,
  SettingsUpdateResult,
  ApiKeySaveParams,
  ApiKeySaveResult,
  ApiKeyValidateParams,
  ApiKeyValidateResult,
} from './settings';
import type { AppInfo } from './app';

type Unsubscribe = () => void;

/**
 * preload 通过 contextBridge 暴露到渲染进程的全局 API（`window.electron`）。
 * 类型与《FreeCoder API 接口设计文档》v1.3 的 25 个通道一一对应。
 */
declare global {
  interface Window {
    electron: {
      chat: {
        send: (params: ChatSendParams) => Promise<ChatSendResult>;
        onResponse: (callback: (data: ChatResponseEvent) => void) => Unsubscribe;
        onSignal: (callback: (data: SignalEvent) => void) => Unsubscribe;
        getHistory: (params: ChatHistoryParams) => Promise<ChatHistoryResult>;
      };
      preview: {
        start: (params: PreviewStartParams) => Promise<PreviewStartResult>;
        stop: () => Promise<PreviewStopResult>;
        refresh: () => Promise<PreviewRefreshResult>;
        onStatus: (callback: (data: PreviewStatusEvent) => void) => Unsubscribe;
        selectElement: (params: ElementSelectParams) => Promise<ElementSelectResult>;
      };
      project: {
        list: () => Promise<ProjectListResult>;
        create: (params: ProjectCreateParams) => Promise<ProjectCreateResult>;
        delete: (params: ProjectDeleteParams) => Promise<ProjectDeleteResult>;
        get: (params: ProjectGetParams) => Promise<ProjectGetResult>;
        confirm: (params: ProjectConfirmParams) => Promise<ProjectConfirmResult>;
        /** 确认版本分段计划（可携带调整后的计划），确认后启动开发 */
        confirmPlan: (params: ProjectConfirmPlanParams) => Promise<ProjectConfirmPlanResult>;
        /** 弹出系统文件夹选择器，返回用户选中的保存位置 */
        selectLocation: () => Promise<ProjectSelectLocationResult>;
      };
      export: {
        start: (params: ExportStartParams) => Promise<ExportStartResult>;
        onComplete: (callback: (data: ExportCompleteEvent) => void) => Unsubscribe;
      };
      db: {
        /** 一键申请云数据库（调用云服务商 API 自动创建，返回连接信息） */
        provision: (params: DbProvisionParams) => Promise<DbProvisionResult>;
      };
      settings: {
        get: () => Promise<SettingsGetResult>;
        update: (params: SettingsUpdateParams) => Promise<SettingsUpdateResult>;
      };
      apikey: {
        save: (params: ApiKeySaveParams) => Promise<ApiKeySaveResult>;
        validate: (params: ApiKeyValidateParams) => Promise<ApiKeyValidateResult>;
      };
      app: {
        getInfo: () => Promise<AppInfo>;
        quit: () => void;
        /** 用系统浏览器打开外部链接（主进程白名单仅允许 http/https） */
        openExternal: (url: string) => Promise<{ success: boolean }>;
      };
    };
  }
}

export {};
