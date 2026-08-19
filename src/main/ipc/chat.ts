import { IpcChannels } from '../../shared/types/ipc';
import type {
  ChatSendParams,
  ChatSendResult,
  ChatHistoryParams,
  ChatHistoryResult,
} from '../../shared/types/chat';
import { handleIpc, IpcError } from './helpers';

/**
 * 对话域 IPC（API 文档 4.1）。
 * WP-03 桩实现：参数校验通过后返回 NOT_IMPLEMENTED，业务逻辑在 WP-10（AI 助理对话流）落地。
 */
export function registerChatIpc(): void {
  handleIpc<ChatSendParams, ChatSendResult>(IpcChannels.chatSend, (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    if (!params?.message?.trim()) {
      throw new IpcError('INVALID_PARAMS', '消息不能为空');
    }
    throw new IpcError('NOT_IMPLEMENTED', '对话功能将在后续版本提供');
  });

  handleIpc<ChatHistoryParams, ChatHistoryResult>(IpcChannels.chatHistory, (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    throw new IpcError('NOT_IMPLEMENTED', '对话历史将在后续版本提供');
  });
}
