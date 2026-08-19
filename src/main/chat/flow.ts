import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import { buildAssistantTask } from '../dsh/prompt';
import { tryParseRequirements, toRequirements } from '../dsh/structured';
import { IpcError } from '../ipc/helpers';

export interface ChatFlowDeps {
  storage: StorageManager;
  dsh: Pick<DSHService, 'runTask'>;
}

export interface ChatSendOutcome {
  messageId: string;
  reply: string;
}

/**
 * AI 助理对话流（需求分析阶段）：
 * 持久化用户消息 → 构建任务 → 调用 DSH headless → 结构化解析需求 → 持久化回复。
 * 依赖注入设计，便于单元测试（IT-IPC-001/002 等价覆盖）。
 */
export class ChatFlow {
  constructor(private readonly deps: ChatFlowDeps) {}

  async handleSend(projectId: string, message: string): Promise<ChatSendOutcome> {
    const storage = this.deps.storage;

    const project = await storage.getProject(projectId);
    if (!project) {
      throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
    }

    // 1. 持久化用户消息
    await storage.saveChatMessage(projectId, {
      role: 'user',
      content: message,
      isComplete: true,
    });

    // 2. 构建任务（系统提示 + 需求上下文 + 历史 + 新消息）
    const history = await storage.getChatHistory(projectId, 30);
    const requirements = await storage.getRequirements(projectId);
    const task = buildAssistantTask({ message, history, requirements });

    // 3. 调用 DSH（以项目代码目录为 workspace）
    const result = await this.deps.dsh.runTask(storage.getProjectCodePath(projectId), task);

    // 4. 结构化解析：若需求收敛则保存需求卡片
    const parsed = tryParseRequirements(result.reply);
    if (parsed) {
      await storage.saveRequirements(projectId, toRequirements(projectId, parsed));
    }

    // 5. 持久化助理回复
    const saved = await storage.saveChatMessage(projectId, {
      role: 'assistant',
      content: result.reply,
      isComplete: true,
    });

    return { messageId: saved.id, reply: result.reply };
  }
}
