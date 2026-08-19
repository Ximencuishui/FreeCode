/** 导出域类型（API 文档 4.4） */

export interface ExportStartParams {
  projectId: string;
  includeDocker?: boolean;
}

export interface ExportStartResult {
  success: boolean;
  exportId?: string;
  error?: string;
}

export interface ExportCompleteEvent {
  exportId: string;
  status: 'success' | 'failed';
  zipPath?: string;
  error?: string;
}
