/** 预览域类型（API 文档 4.2） */

export interface PreviewStartParams {
  projectId: string;
}

export interface PreviewStartResult {
  success: boolean;
  url?: string;
  port?: number;
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
