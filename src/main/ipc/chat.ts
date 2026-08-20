import { BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/types/ipc';
import type {
  ChatSendParams,
  ChatSendResult,
  ChatResponseEvent,
  ChatHistoryParams,
  ChatHistoryResult,
} from '../../shared/types/chat';
import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import { ChatFlow } from '../chat/flow';
import { handleIpc, IpcError } from './helpers';

/** 向所有窗口推送 chat:response 事件 */
function broadcastResponse(projectId: string, event: ChatResponseEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.chatResponse, { ...event, projectId });
  }
}

/**
 * 对话域 IPC（API 文档 4.1）。
 * chat:send 走完整 AI 助理对话流（ChatFlow + DSH headless）。
 */
export function registerChatIpc(storage: StorageManager, dsh: DSHService): void {
  const flow = new ChatFlow({ storage, dsh });

  handleIpc<ChatSendParams, ChatSendResult>(IpcChannels.chatSend, async (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    if (!params?.message?.trim()) {
      throw new IpcError('INVALID_PARAMS', '消息不能为空');
    }

    // 推送处理中状态（headless 非流式，模拟流式体验）
    broadcastResponse(params.projectId, {
      type: 'thinking',
      content: '正在分析您的需求…',
      timestamp: new Date().toISOString(),
    });

    const { messageId, reply } = await flow.handleSend(
      params.projectId,
      params.message.trim(),
      params.selectedElement,
    );

    // 附带最新需求卡片（供渲染进程刷新需求面板）
    const requirements = await storage.getRequirements(params.projectId);
    const timestamp = new Date().toISOString();
    broadcastResponse(params.projectId, {
      type: 'message',
      content: reply,
      messageId,
      isComplete: true,
      requirements: requirements
        ? {
            goal: requirements.goal,
            targetUsers: requirements.targetUsers,
            coreFeatures: requirements.coreFeatures,
            visualStyle: requirements.visualStyle,
            confirmed: requirements.confirmed,
          }
        : null,
      timestamp,
    });
    broadcastResponse(params.projectId, {
      type: 'done',
      messageId,
      timestamp,
    });

    return { success: true, messageId };
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
