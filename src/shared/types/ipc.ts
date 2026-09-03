/**
 * IPC 通道名常量与统一错误契约。
 * 依据《FreeCoder API 接口设计文档》v1.3 定义 IPC 通道与错误码体系。
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
  previewOpenExternal: 'preview:open-external',
  // 项目
  projectList: 'project:list',
  projectCreate: 'project:create',
  projectDelete: 'project:delete',
  projectGet: 'project:get',
  projectConfirm: 'project:confirm',
  projectConfirmPlan: 'project:confirm-plan',
  projectSelectLocation: 'project:select-location',
  projectUpdateRequirements: 'project:update-requirements',
  projectResumeDevelopment: 'project:resume-development',
  projectAutoTest: 'project:auto-test',
  projectConvertToLocalMode: 'project:convert-to-local-mode',
  /** v3.2.2 P0-5：取消指定项目的开发任务（切项目时由前端调用） */
  projectCancelDevelopment: 'project:cancel-development',
  /** 扫描项目根目录、docs 与常见图片素材，返回可阅读条目 */
  projectListDocuments: 'project:list-documents',
  /** 按主进程扫描到的相对路径读取 Markdown 或图片素材 */
  projectReadDocument: 'project:read-document',
  /** 用系统默认应用打开一个项目内的图片素材（仅 SVG 等可外部查看的格式） */
  projectOpenAsset: 'project:open-asset',
  // 导出
  exportStart: 'export:start',
  exportComplete: 'export:complete',
  /** v3.2.2 P0-5：取消指定项目的导出任务（切项目时由前端调用） */
  exportCancel: 'export:cancel',
  // 智能打包（electron-builder 桌面端安装包）
  packageStart: 'package:start',
  packageProgress: 'package:progress',
  packageComplete: 'package:complete',
  /** v3.2.2 P0-5：取消指定项目的打包任务（切项目时由前端调用） */
  packageCancel: 'package:cancel',
  // 云数据库（一键申请）
  dbProvision: 'db:provision',
  // 设置
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  // API Key
  apiKeySave: 'apikey:save',
  apiKeyValidate: 'apikey:validate',
  apiKeyTest: 'apikey:test',
  // 对话控制
  chatStop: 'chat:stop',
  // 应用
  appInfo: 'app:info',
  appQuit: 'app:quit',
  appOpenExternal: 'app:open-external',
  appRevealInFolder: 'app:reveal-in-folder',
  // dsh 运行时状态（方案 3：按需启动 vs 缺失/异常的实时区分）
  dshState: 'dsh:state',
  dshStateChange: 'dsh:state-change',
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
  | 'DSH_TIMEOUT'
  | 'TASK_CANCELLED'
  | 'API_KEY_INVALID'
  | 'API_KEY_MISSING'
  | 'RATE_LIMIT'
  | 'PREVIEW_NOT_RUNNING'
  | 'PREVIEW_ALREADY_RUNNING'
  | 'EXPORT_FAILED'
  | 'FILE_IO_ERROR'
  | 'DB_PROVIDER_UNSUPPORTED'
  | 'DB_PROVISION_FAILED'
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
