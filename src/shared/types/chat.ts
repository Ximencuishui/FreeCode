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

export interface ChatResponseEvent {
  type: 'message' | 'thinking' | 'done' | 'error';
  content?: string;
  messageId?: string;
  isComplete?: boolean;
  timestamp: string;
}

export type SignalType = 'info' | 'warning' | 'error' | 'question';

export interface SignalEvent {
  type: SignalType;
  message: string;
  suggestions?: string[];
  code?: string;
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
