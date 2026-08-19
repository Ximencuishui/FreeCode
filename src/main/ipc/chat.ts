import { IpcChannels } from '../../shared/types/ipc';
import type {
  ChatSendParams,
  ChatSendResult,
  ChatHistoryParams,
  ChatHistoryResult,
} from '../../shared/types/chat';
import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import { handleIpc, IpcError } from './helpers';

/**
 * 对话域 IPC（API 文档 4.1）。
 * 对话历史基于本地存储；AI 助理对话流（调用 DSH）在 WP-10 落地。
 */
export function registerChatIpc(storage: StorageManager, dsh: DSHService): void {
  handleIpc<ChatSendParams, ChatSendResult>(IpcChannels.chatSend, async (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    if (!params?.message?.trim()) {
      throw new IpcError('INVALID_PARAMS', '消息不能为空');
    }
    const project = await storage.getProject(params.projectId);
    if (!project) {
      throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
    }
    // dsh 服务已注入，对话流编排在 WP-10 实现
    void dsh;
    throw new IpcError('NOT_IMPLEMENTED', 'AI 对话将在后续版本提供');
  });

  handleIpc<ChatHistoryParams, ChatHistoryResult>(IpcChannels.chatHistory, async (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    const project = await storage.getProject(params.projectId);
    if (!project) {
      throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
    }
    const messages = await storage.getChatHistory(params.projectId, params.limit ?? 50);
    return {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role === 'signal' ? 'system' : m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    };
  });
}
