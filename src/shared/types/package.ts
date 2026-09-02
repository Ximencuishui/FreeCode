/**
 * 智能打包域类型。
 * "智能打包"指把用户项目打成桌面端安装包（.exe / .dmg / .AppImage），
 * 通过 FreeCoder 内置的 electron 壳工程模板 + electron-builder 实现。
 */

export type PackageTarget = 'auto' | 'current-os';

export interface PackageStartParams {
  projectId: string;
  /** 产物目标：auto=跟随当前 OS；current-os=显式当前 OS。默认 auto */
  target?: PackageTarget;
}

export interface PackageStartResult {
  success: boolean;
  /** 任务 ID，前端可用于关联 complete 事件 */
  packageId?: string;
  error?: string;
}

export type PackageStage =
  | 'preparing'
  | 'copying-app'
  | 'rendering-shell'
  | 'electron-builder'
  | 'finalizing';

export interface PackageProgressEvent {
  packageId: string;
  stage: PackageStage;
  /** 当前阶段的人可读提示 */
  message: string;
  /** electron-builder 输出的原始日志片段（可选） */
  detail?: string;
}

export type PackageFinalStatus = 'success' | 'failed' | 'cancelled';

export interface PackageCompleteEvent {
  packageId: string;
  status: PackageFinalStatus;
  /** 产物绝对目录（status='success' 时），含 .exe/.dmg/.AppImage 等 */
  outputDir?: string;
  /** 主要可执行文件名（如 FreeCoder Demo Setup 0.1.0.exe） */
  artifactName?: string;
  error?: string;
}