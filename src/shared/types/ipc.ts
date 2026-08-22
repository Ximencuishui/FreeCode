/**
 * IPC 通道名常量与统一错误契约。
 * 依据《FreeCoder API 接口设计文档》v1.0 定义（23 个通道、错误码体系）。
 */

/** 全部 IPC 通道（渲染进程 ↔ 主进程） */
export const IpcChannels = {
  // 对话
  chatSend: 'chat:send',
  chatResponse: 'chat:response',
  chatSignal: 'chat:signal',
  chatHistory: 'chat:history',
  // 预览
  previewStart: 'preview:start',
  previewStop: 'preview:stop',
  previewStatus: 'preview:status',
  previewElement: 'preview:element',
  previewRefresh: 'preview:refresh',
  // 项目
  projectList: 'project:list',
  projectCreate: 'project:create',
  projectDelete: 'project:delete',
  projectGet: 'project:get',
  projectConfirm: 'project:confirm',
  projectConfirmPlan: 'project:confirm-plan',
  projectSelectLocation: 'project:select-location',
  // 导出
  exportStart: 'export:start',
  exportComplete: 'export:complete',
  // 设置
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  // API Key
  apiKeySave: 'apikey:save',
  apiKeyValidate: 'apikey:validate',
  // 应用
  appInfo: 'app:info',
  appQuit: 'app:quit',
  appOpenExternal: 'app:open-external',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/** 业务错误码（API 文档 5.1 / 5.2） */
export type ErrorCode =
  // 通用
  | 'SUCCESS'
  | 'UNKNOWN_ERROR'
  | 'INVALID_PARAMS'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  // 业务
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_ALREADY_EXISTS'
  | 'PROJECT_NAME_EMPTY'
  | 'DSH_NOT_RUNNING'
  | 'DSH_RUNNING'
  | 'DSH_START_FAILED'
  | 'API_KEY_INVALID'
  | 'API_KEY_MISSING'
  | 'PREVIEW_NOT_RUNNING'
  | 'PREVIEW_ALREADY_RUNNING'
  | 'EXPORT_FAILED'
  | 'FILE_IO_ERROR'
  // 工程占位
  | 'NOT_IMPLEMENTED';

/** 统一错误对象（API 文档 5.3） */
export interface FreeCoderError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** 统一错误响应 */
export interface ErrorResponse {
  success: false;
  error: FreeCoderError;
}

/** 通用成功响应包装（用于 invoke 类接口） */
export type IpcResult<T> = { success: true; data: T } | ErrorResponse;
