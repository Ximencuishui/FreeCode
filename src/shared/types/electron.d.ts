import type {
  ChatSendParams,
  ChatSendResult,
  ChatStopParams,
  ChatStopResult,
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
  PreviewOpenExternalResult,
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
  UpdateRequirementsParams,
  UpdateRequirementsResult,
  ProjectResumeDevelopmentParams,
  ProjectResumeDevelopmentResult,
  ProjectAutoTestParams,
  ProjectAutoTestResult,
  ProjectConvertToLocalModeParams,
  ProjectConvertToLocalModeResult,
  ProjectDocumentListParams,
  ProjectDocumentListResult,
  ProjectDocumentReadParams,
  ProjectDocumentReadResult,
  ProjectOpenAssetParams,
  ProjectOpenAssetResult,
} from './project';
import type { ExportStartParams, ExportStartResult, ExportCompleteEvent } from './export';
import type {
  PackageStartParams,
  PackageStartResult,
  PackageProgressEvent,
  PackageCompleteEvent,
} from './package';
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
  ApiKeyTestParams,
  ApiKeyTestResult,
  ApiKeyValidateParams,
  ApiKeyValidateResult,
} from './settings';
import type { AppInfo } from './app';
import type { DSHState } from './dsh';

type Unsubscribe = () => void;

/**
 * preload 通过 contextBridge 暴露到渲染进程的全局 API（`window.electron`）。
 * 类型与《FreeCoder API 接口设计文档》v1.3 的 IPC 通道一一对应。
 */
declare global {
  interface Window {
    electron: {
      chat: {
        send: (params: ChatSendParams) => Promise<ChatSendResult>;
        /** 主动停止当前任务（中断 dsh 子进程，不产生回复） */
        stop: (params: ChatStopParams) => Promise<ChatStopResult>;
        onResponse: (callback: (data: ChatResponseEvent) => void) => Unsubscribe;
        onSignal: (callback: (data: SignalEvent) => void) => Unsubscribe;
        getHistory: (params: ChatHistoryParams) => Promise<ChatHistoryResult>;
      };
      preview: {
        start: (params: PreviewStartParams) => Promise<PreviewStartResult>;
        stop: () => Promise<PreviewStopResult>;
        refresh: () => Promise<PreviewRefreshResult>;
        /** 用系统浏览器打开当前预览（真实测试，不受元素选择干扰） */
        openExternal: () => Promise<PreviewOpenExternalResult>;
        onStatus: (callback: (data: PreviewStatusEvent) => void) => Unsubscribe;
        selectElement: (params: ElementSelectParams) => Promise<ElementSelectResult>;
        /**
         * 订阅 resources/preview/inspector.js 文件变更事件（仅 dev 模式会触发）。
         * 收到事件时渲染端应 webview.reload()，让 webview preload 重新加载最新代码，
         * 避免 HMR 不感知 webview preload 导致老代码残留。
         */
        onInspectorChanged: (callback: (data: PreviewInspectorChangedEvent) => void) => Unsubscribe;
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
        /** 手动编辑需求（确认前修改需求项并持久化） */
        updateRequirements: (
          params: UpdateRequirementsParams,
        ) => Promise<UpdateRequirementsResult>;
        /** 恢复/重启开发任务（开发被中断时，从进度引导卡触发） */
        resumeDevelopment: (
          params: ProjectResumeDevelopmentParams,
        ) => Promise<ProjectResumeDevelopmentResult>;
        /** 自动测试：编写测试用例、运行检查并审计代码，输出测试报告 */
        autoTest: (params: ProjectAutoTestParams) => Promise<ProjectAutoTestResult>;
        /** v3.2.2 P0-5：取消指定项目的开发任务（切项目时调用，让旧项目 DSH 进程中断） */
        cancelDevelopment: (params: { projectId: string }) => Promise<{ success: boolean; cancelled: boolean }>;
        /** 转本地模式：把 requirements.authentication 改为 none 并打回 planned，
         *  让用户在对话页重新触发「确认 V1 计划 → 重新开发」以应用新 prompt 生成纯前端版本 */
        convertToLocalMode: (
          params: ProjectConvertToLocalModeParams,
        ) => Promise<ProjectConvertToLocalModeResult>;
        /** 扫描当前项目的 Markdown 文档与常见图片素材 */
        listDocuments: (params: ProjectDocumentListParams) => Promise<ProjectDocumentListResult>;
        /** 读取一个已发现的文档或图片素材 */
        readDocument: (params: ProjectDocumentReadParams) => Promise<ProjectDocumentReadResult>;
        /** 用系统默认应用打开一个项目内的图片素材（主进程校验路径仍在项目目录内） */
        openAsset: (params: ProjectOpenAssetParams) => Promise<ProjectOpenAssetResult>;
      };
      export: {
        start: (params: ExportStartParams) => Promise<ExportStartResult>;
        onComplete: (callback: (data: ExportCompleteEvent) => void) => Unsubscribe;
        /** v3.2.2 P0-5：取消指定项目的导出任务（切项目时调用） */
        cancel: (params: { projectId: string }) => Promise<{ success: boolean; cancelled: boolean }>;
      };
      package: {
        /** 启动桌面端打包任务；产物路径通过 onComplete 推送 */
        start: (params: PackageStartParams) => Promise<PackageStartResult>;
        /** 订阅打包进度推送（阶段 + 人可读 message + electron-builder 原始日志） */
        onProgress: (callback: (data: PackageProgressEvent) => void) => Unsubscribe;
        /** 订阅打包完成事件（success/failed/cancelled） */
        onComplete: (callback: (data: PackageCompleteEvent) => void) => Unsubscribe;
        /** v3.2.2 P0-5：取消指定项目的打包任务（切项目时调用） */
        cancel: (params: { projectId: string }) => Promise<{ success: boolean; cancelled: boolean }>;
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
        /** 真实连接测试：用待保存的 Key 调端点 /models，验证 Key 有效性与连通性 */
        test: (params: ApiKeyTestParams) => Promise<ApiKeyTestResult>;
      };
      app: {
        getInfo: () => Promise<AppInfo>;
        quit: () => void;
        /** 用系统浏览器打开外部链接（主进程白名单仅允许 http/https） */
        openExternal: (url: string) => Promise<{ success: boolean }>;
        /** 在系统文件管理器中高亮显示本地文件（用于打开导出/打包产物） */
        revealInFolder: (path: string) => Promise<{ success: boolean }>;
      };
      /** 方案 3：dsh 运行时实时状态（按需启动 vs 缺失/异常的实时区分） */
      dsh: {
        /** 拉一次状态快照 */
        state: () => Promise<DSHState>;
        /** 订阅状态变化推送（每次 DSHService 聚合状态切换都触发） */
        onStateChange: (callback: (data: DSHState) => void) => Unsubscribe;
      };
    };
  }
}

export {};
