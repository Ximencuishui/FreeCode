import { IpcChannels } from '../../shared/types/ipc';
import type { ExportStartParams, ExportStartResult } from '../../shared/types/export';
import { handleIpc, IpcError } from './helpers';

/**
 * 导出域 IPC（API 文档 4.4）。
 * WP-03 桩实现：返回 NOT_IMPLEMENTED；业务逻辑在 WP-18（导出部署包）落地。
 */
export function registerExportIpc(): void {
  handleIpc<ExportStartParams, ExportStartResult>(IpcChannels.exportStart, (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    throw new IpcError('NOT_IMPLEMENTED', '导出将在后续版本提供');
  });
}
