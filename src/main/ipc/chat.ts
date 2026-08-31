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
import { DSHError } from '../dsh/errors';
import { handleIpc, IpcError } from './helpers';
import { toolProgressLabel } from '../dev/developer';

/** 向所有窗口推送 chat:response 事件 */
function broadcastResponse(projectId: string, event: ChatResponseEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.chatResponse, { ...event, projectId });
  }
}

/**
 * 对话域 IPC（API 文档 4.1）。
 * chat:send 走完整 AI 助理对话流（ChatFlow + DSH headless）。
 * 同一项目同时只允许一个任务在执行；新消息会中断当前任务（用户可随时插话调整需求），
 * 也可通过 chat:stop 主动停止。
 */
export function registerChatIpc(storage: StorageManager, dsh: DSHService): void {
  const flow = new ChatFlow({ storage, dsh });

  /** 当前正在执行的任务（按项目）：新消息/停止时 abort 以中断 */
  const activeTasks = new Map<string, AbortController>();

  const cancelTask = (projectId: string): void => {
    const controller = activeTasks.get(projectId);
    if (controller) controller.abort();
  };

  handleIpc<ChatSendParams, ChatSendResult>(IpcChannels.chatSend, async (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    if (!params?.message?.trim()) {
      throw new IpcError('INVALID_PARAMS', '消息不能为空');
    }

    // 同一项目已有任务在跑：先中断（用户插话调整需求），再启动新任务
    cancelTask(params.projectId);
    const controller = new AbortController();
    activeTasks.set(params.projectId, controller);

    // 推送处理中状态（headless 非流式，模拟流式体验；推理增量实时转发，避免用户空等）
    const startedAt = Date.now();
    let liveReasoning = '';
    broadcastResponse(params.projectId, {
      type: 'thinking',
      content: '正在分析您的需求…',
      timestamp: new Date().toISOString(),
    });
    const progressTimer = setInterval(() => {
      // 推理流展示中则以推理为准；否则周期性报已用时，证明任务仍在执行
      if (liveReasoning) return;
      const secs = Math.round((Date.now() - startedAt) / 1000);
      broadcastResponse(params.projectId, {
        type: 'thinking',
        content: `AI 正在执行中，已用时 ${secs} 秒（推理模型较慢，请耐心等待…）`,
        timestamp: new Date().toISOString(),
      });
    }, 10_000);

    let outcome: { messageId: string; reply: string; reasoning?: string };
    try {
      outcome = await flow.handleSend(
        params.projectId,
        params.message.trim(),
        params.selectedElement,
        (update) => {
          // 推理流：实时累加展示（避免用户空等）
          if (update.kind === 'reasoning') {
            liveReasoning += update.text;
            broadcastResponse(params.projectId, {
              type: 'thinking',
              content: liveReasoning,
              timestamp: new Date().toISOString(),
            });
            return;
          }
          // 工具调用 / 工具结果：转成"开发进度"广播，与项目开发路径一致，
          // 让"💬 开发日志"标签在 chat 修改模式下也能看到 DSH 的操作过程。
          // （draft 阶段走需求分析 prompt，DSH 不会调工具，自然不会出现误报）
          let label: string | null = null;
          if (update.kind === 'tool') {
            label = toolProgressLabel(update.text);
          } else if (update.kind === 'tool-result') {
            const text = update.text.trim().replace(/\s+/g, ' ').slice(0, 100);
            if (text) label = `✓ ${text}`;
          }
          if (label) {
            broadcastResponse(params.projectId, {
              type: 'progress',
              content: label,
              timestamp: new Date().toISOString(),
            });
          }
        },
        controller.signal,
      );
    } catch (error) {
      // 被新消息/停止中断：静默成功（不广播任何事件，避免残留错误气泡）
      if (error instanceof DSHError && error.code === 'TASK_CANCELLED') {
        return { success: true };
      }
      throw error;
    } finally {
      clearInterval(progressTimer);
      if (activeTasks.get(params.projectId) === controller) {
        activeTasks.delete(params.projectId);
      }
    }
    const { messageId, reply, reasoning } = outcome;

    // 附带最新需求卡片（供渲染进程刷新需求面板）
    const requirements = await storage.getRequirements(params.projectId);
    const timestamp = new Date().toISOString();
    broadcastResponse(params.projectId, {
      type: 'message',
      content: reply,
      reasoning,
      messageId,
      isComplete: true,
      requirements: requirements
        ? {
            goal: requirements.goal,
            targetUsers: requirements.targetUsers,
            coreFeatures: requirements.coreFeatures,
            visualStyle: requirements.visualStyle,
            pages: requirements.pages,
            layout: requirements.layout,
            styleFeeling: requirements.styleFeeling,
            device: requirements.device,
            keyFlows: requirements.keyFlows,
            authentication: requirements.authentication,
            usageScale: requirements.usageScale,
            exportFeatures: requirements.exportFeatures,
            uiLanguage: requirements.uiLanguage,
            platform: requirements.platform,
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

  /** 主动停止当前任务（中断 dsh 子进程，不产生回复） */
  handleIpc<{ projectId: string }, { success: boolean }>(
    IpcChannels.chatStop,
    async (_event, params) => {
      if (params?.projectId) cancelTask(params.projectId);
      return { success: true };
    },
  );

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
        reasoning: m.reasoning,
        timestamp: m.timestamp,
      })),
    };
  });
}
