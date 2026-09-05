/** 预览域类型（API 文档 4.2） */

export interface PreviewStartParams {
  projectId: string;
}

export interface PreviewStartResult {
  success: boolean;
  url?: string;
  port?: number;
  /** webview 元素检查器 preload 脚本路径 */
  inspectorPath?: string;
  error?: string;
}

export interface PreviewStopResult {
  success: boolean;
}

export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface PreviewStatusEvent {
  status: PreviewStatus;
  url?: string;
  progress?: number;
  message?: string;
  /** 文件变更热加载信号：为 true 时渲染进程应刷新预览 */
  reload?: boolean;
}

/** dev 模式专用：resources/preview/inspector.js 文件被修改后主进程广播的事件 */
export interface PreviewInspectorChangedEvent {
  /** inspector.js 文件的最新 mtime（ms） */
  mtimeMs: number;
  /** 文件路径，方便调试 */
  inspectorPath: string;
}

export interface ElementInfo {
  tag: string;
  id?: string;
  className?: string;
  content: string;
  selector: string;
  styles: {
    color?: string;
    fontSize?: string;
    fontWeight?: string;
    backgroundColor?: string;
    margin?: string;
    padding?: string;
    borderRadius?: string;
  };
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ElementSelectParams {
  element: ElementInfo;
}

export interface SuggestedAction {
  label: string;
  action: string;
}

export interface ElementSelectResult {
  success: boolean;
  elementInfo?: {
    name: string;
    description: string;
    suggestedActions: SuggestedAction[];
  };
}

export interface PreviewRefreshResult {
  success: boolean;
}

export interface PreviewOpenExternalResult {
  success: boolean;
  /** 当前预览地址（供 AI 引导文案使用） */
  url?: string;
}
