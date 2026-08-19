import { IpcChannels } from '../../shared/types/ipc';
import type {
  PreviewStartParams,
  PreviewStartResult,
  PreviewStopResult,
  ElementSelectParams,
  ElementSelectResult,
  PreviewRefreshResult,
} from '../../shared/types/preview';
import { handleIpc, IpcError } from './helpers';

/**
 * 预览域 IPC（API 文档 4.2）。
 * WP-03 桩实现：返回 NOT_IMPLEMENTED；业务逻辑在 WP-13（预览服务器）落地。
 */
export function registerPreviewIpc(): void {
  handleIpc<PreviewStartParams, PreviewStartResult>(IpcChannels.previewStart, (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    throw new IpcError('NOT_IMPLEMENTED', '预览将在后续版本提供');
  });

  handleIpc<undefined, PreviewStopResult>(IpcChannels.previewStop, () => {
    throw new IpcError('PREVIEW_NOT_RUNNING', '预览尚未启动');
  });

  handleIpc<undefined, PreviewRefreshResult>(IpcChannels.previewRefresh, () => {
    throw new IpcError('PREVIEW_NOT_RUNNING', '预览尚未启动');
  });

  handleIpc<ElementSelectParams, ElementSelectResult>(IpcChannels.previewElement, (_event, params) => {
    if (!params?.element) {
      throw new IpcError('INVALID_PARAMS', '元素信息不能为空');
    }
    throw new IpcError('NOT_IMPLEMENTED', '元素识别将在后续版本提供');
  });
}
