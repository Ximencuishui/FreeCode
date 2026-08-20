import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import type { ElementInfo } from '../../shared/types/preview';
import { buildAssistantTask, buildModifyTask } from '../dsh/prompt';
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
 * AI 助理对话流：
 * - 需求阶段（draft）：需求分析对话，收敛后保存需求卡片
 * - 修改阶段（ready/exported）：口语修改指令，DSH 直接编辑现有代码
 * 依赖注入设计，便于单元测试（IT-IPC-001/002 等价覆盖）。
 */
export class ChatFlow {
  constructor(private readonly deps: ChatFlowDeps) {}

  async handleSend(
    projectId: string,
    message: string,
    selectedElement?: ElementInfo,
  ): Promise<ChatSendOutcome> {
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

    // 2. 根据项目阶段构建任务（ready 后进入修改阶段）
    const history = await storage.getChatHistory(projectId, 30);
    const requirements = await storage.getRequirements(projectId);
    const isModifyPhase = project.status === 'ready' || project.status === 'exported';
    const task = isModifyPhase
      ? buildModifyTask(message, selectedElement, requirements)
      : buildAssistantTask({ message, history, requirements });

    // 3. 调用 DSH（以项目代码目录为 workspace）
    const result = await this.deps.dsh.runTask(storage.getProjectCodePath(projectId), task);

    // 4. 需求阶段：若需求收敛则保存需求卡片
    if (!isModifyPhase) {
      const parsed = tryParseRequirements(result.reply);
      if (parsed) {
        await storage.saveRequirements(projectId, toRequirements(projectId, parsed));
      }
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
