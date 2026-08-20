/** 对话域类型（API 文档 4.1） */

export interface ChatSendParams {
  projectId: string;
  message: string;
  attachments?: {
    type: 'image' | 'file';
    data: string;
  }[];
}

export interface ChatSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

import type { RequirementSummary } from './project';

export interface ChatResponseEvent {
  type: 'message' | 'thinking' | 'done' | 'error';
  content?: string;
  messageId?: string;
  isComplete?: boolean;
  /** message 事件附带最新需求卡片（如有） */
  requirements?: RequirementSummary | null;
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
  timestamp: string;
}

export interface ChatHistoryResult {
  messages: ChatMessageRecord[];
}
