/**
 * 对话状态（Zustand）。
 * 与主进程通过 chat:send / chat:response / chat:signal / chat:history 通信。
 */
import { create } from 'zustand';
import type { RequirementSummary } from '@shared/types/project';

export interface ChatOption {
  key: string;
  label: string;
}

export interface ChatMessageUI {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  options?: ChatOption[];
}

interface ChatState {
  messages: ChatMessageUI[];
  isProcessing: boolean;
  currentProjectId: string | null;
  requirements: RequirementSummary | null;
  projectStatus: 'draft' | 'developing' | 'ready' | 'exported' | null;

  setProject: (id: string | null) => void;
  setRequirements: (req: RequirementSummary | null) => void;
  setProjectStatus: (status: ChatState['projectStatus']) => void;
  setProcessing: (v: boolean) => void;
  pushMessage: (msg: Omit<ChatMessageUI, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => void;
  clearMessages: () => void;
  loadHistory: (projectId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
}

let msgSeq = 0;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isProcessing: false,
  currentProjectId: null,
  requirements: null,
  projectStatus: null,

  setProject: (id) => set({ currentProjectId: id, requirements: null, projectStatus: null }),
  setRequirements: (req) => set({ requirements: req }),
  setProjectStatus: (status) => set({ projectStatus: status }),
  setProcessing: (v) => set({ isProcessing: v }),

  pushMessage: (msg) => {
    msgSeq += 1;
    const full: ChatMessageUI = {
      ...msg,
      id: msg.id ?? `local-${msgSeq}`,
      timestamp: msg.timestamp ?? new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, full] }));
  },

  clearMessages: () => set({ messages: [] }),

  loadHistory: async (projectId) => {
    try {
      const result = await window.electron.chat.getHistory({ projectId, limit: 50 });
      set({
        messages: result.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
      });
    } catch {
      set({ messages: [] });
    }
  },

  sendMessage: async (text) => {
    const { currentProjectId, pushMessage } = get();
    const trimmed = text.trim();
    if (!trimmed || !currentProjectId) return;

    pushMessage({ role: 'user', content: trimmed });
    set({ isProcessing: true });

    try {
      await window.electron.chat.send({ projectId: currentProjectId, message: trimmed });
      // 回复经 chat:response 事件到达（useChatEvents）
    } catch (err) {
      const message =
        typeof err === 'object' && err !== null && 'error' in err
          ? String((err as { error: { message: string } }).error.message)
          : '发送失败，请重试';
      pushMessage({ role: 'system', content: message });
      set({ isProcessing: false });
    }
  },
}));
