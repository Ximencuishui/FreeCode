import type { RequirementSummary, StructuredTestReport } from './project';
import type { ElementInfo } from './preview';

/** 对话域类型（API 文档 4.1） */

export interface ChatSendParams {
  projectId: string;
  message: string;
  attachments?: {
    type: 'image' | 'file';
    data: string;
  }[];
  /** 口语修改：当前选中的预览元素（预览修改模式下附带） */
  selectedElement?: ElementInfo;
}

export interface ChatSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface ChatStopParams {
  projectId: string;
}

export interface ChatStopResult {
  success: boolean;
}

/** chat:response 事件的来源（renderer 据此分别处理，如右侧窗口显示测试进度） */
export type ChatResponseSource = 'chat' | 'developer' | 'auto-test';

export interface ChatResponseEvent {
  type: 'message' | 'thinking' | 'progress' | 'done' | 'error';
  content?: string;
  /** 模型推理过程（思考过程；message 事件附带） */
  reasoning?: string;
  messageId?: string;
  isComplete?: boolean;
  /** message 事件附带最新需求卡片（如有） */
  requirements?: RequirementSummary | null;
  /** 事件来源：用于 renderer 区分通用对话 / 开发过程 / 自动测试 */
  source?: ChatResponseSource;
  /**
   * 自动测试报告（仅 source='auto-test' 且 type='message' 时附带）。
   * 渲染端据此分流完成态（pass/warn/block）。
   */
  autoTestReport?: StructuredTestReport;
  timestamp: string;
}

export type SignalType = 'info' | 'warning' | 'error' | 'question';

export interface SignalEvent {
  type: SignalType;
  message: string;
  suggestions?: string[];
  code?: string;
  autoAction?: string;
  timestamp: string;
}

export interface ChatHistoryParams {
  projectId: string;
  limit?: number;
}

export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 模型推理过程（思考过程，可为空） */
  reasoning?: string;
  timestamp: string;
}

export interface ChatHistoryResult {
  messages: ChatMessageRecord[];
}
