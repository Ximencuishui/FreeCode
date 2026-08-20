/**
 * 对话状态（Zustand）。
 * 与主进程通过 chat:send / chat:response / chat:signal / chat:history 通信。
 */
import { create } from 'zustand';
import type { RequirementSummary } from '@shared/types/project';
import type { ElementInfo, ElementSelectResult } from '@shared/types/preview';
import { useUiStore } from './ui';

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
  /** 预览中选中的元素（口语修改上下文） */
  selectedElement: ElementInfo | null;
  /** 选中元素的友好描述（右侧检查器展示） */
  elementInfo: ElementSelectResult['elementInfo'] | null;

  setProject: (id: string | null) => void;
  setRequirements: (req: RequirementSummary | null) => void;
  setProjectStatus: (status: ChatState['projectStatus']) => void;
  setSelectedElement: (el: ElementInfo | null) => void;
  setElementInfo: (info: ElementSelectResult['elementInfo'] | null) => void;
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
  selectedElement: null,
  elementInfo: null,

  setProject: (id) =>
    set({
      currentProjectId: id,
      requirements: null,
      projectStatus: null,
      selectedElement: null,
      elementInfo: null,
      isProcessing: false,
    }),
  setRequirements: (req) => set({ requirements: req }),
  setProjectStatus: (status) => set({ projectStatus: status }),
  setSelectedElement: (el) => set({ selectedElement: el }),
  setElementInfo: (info) => set({ elementInfo: info }),
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
    const { currentProjectId, pushMessage, selectedElement } = get();
    const trimmed = text.trim();
    if (!trimmed || !currentProjectId) return;

    // API 配置未知或未配置：弹出配置引导（与 DeepSeek Harness 一致），不发送
    const { apiKeyConfigured, openSettings } = useUiStore.getState();
    if (apiKeyConfigured !== true) {
      openSettings();
      return;
    }

    pushMessage({ role: 'user', content: trimmed });
    set({ isProcessing: true });

    try {
      const result = await window.electron.chat.send({
        projectId: currentProjectId,
        message: trimmed,
        selectedElement: selectedElement ?? undefined,
      });
      // 主进程失败时以 { success:false, error } resolve（不会 reject），需自行收尾
      if (!result.success) {
        // 运行时 error 可能是 FreeCoderError 对象（类型标注为 string，属历史类型缺口）
        const raw = result.error as unknown;
        const message =
          typeof raw === 'string'
            ? raw
            : raw && typeof raw === 'object' && 'message' in raw
              ? String((raw as { message: unknown }).message)
              : '发送失败，请重试';
        pushMessage({ role: 'system', content: message });
        set({ isProcessing: false });
      }
      // 回复经 chat:response 事件到达（useChatEvents），成功路径由 done 事件复位
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
