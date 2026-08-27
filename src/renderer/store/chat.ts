/**
 * 对话状态（Zustand）。
 * 与主进程通过 chat:send / chat:response / chat:signal / chat:history 通信。
 */
import { create } from 'zustand';
import type { RequirementSummary, VersionPlan, ProjectStatus } from '@shared/types/project';
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
  /** 模型推理过程（思考过程，折叠展示） */
  reasoning?: string;
  timestamp: string;
  options?: ChatOption[];
}

/** 重新进入中途项目时的进度引导（AI 助理汇报进度 + 继续下一步） */
export type ResumeAction =
  | 'confirm-requirements'
  | 'confirm-plan'
  | 'goto-preview'
  | 'goto-chat'
  | 'refresh-status'
  | 'open-browser'
  | 'auto-test'
  | 'none';

export interface ResumeGuide {
  projectId: string;
  projectName: string;
  /** 当前阶段描述（口语化） */
  phaseText: string;
  /** 下一步动作 */
  action: ResumeAction;
  /** 下一步按钮文案 */
  actionText: string;
  /** 多动作模式：提供多个按钮（如就绪后的"浏览器打开 / 自动测试"）；提供时优先渲染 */
  actions?: { action: ResumeAction; label: string }[];
}

interface ChatState {
  messages: ChatMessageUI[];
  isProcessing: boolean;
  /** 处理中的实时提示文案（主进程周期性推送，如"已用时 30 秒"） */
  thinkingText: string | null;
  /** 开发任务是否正在运行（进度引导卡据此区分"是否继续"与"开发中"） */
  devTaskRunning: boolean;
  /** 一键自动测试是否正在运行（用户点击"已经 ok，请帮我测试"后置 true，测试报告到达后置 false） */
  autoTestRunning: boolean;
  /** 自动测试最近一条进度文本（用于 ResumeCard 实时反馈） */
  autoTestLatestProgress: string | null;
  /** 最近一次自动测试的完成摘要（测试报告到达时保存，用于"测试完成"状态展示） */
  lastTestSummary: string | null;
  /** 开发进度报告（工具调用流：📝 写入 index.html 等） */
  devProgress: string[];
  currentProjectId: string | null;
  requirements: RequirementSummary | null;
  projectStatus: ProjectStatus | null;
  /** 版本分段计划（需求确认后、写代码前） */
  versionPlan: VersionPlan | null;
  /** 预览中选中的元素（口语修改上下文） */
  selectedElement: ElementInfo | null;
  /** 选中元素的友好描述（右侧检查器展示） */
  elementInfo: ElementSelectResult['elementInfo'] | null;

  setProject: (id: string | null) => void;
  setRequirements: (req: RequirementSummary | null) => void;
  setProjectStatus: (status: ChatState['projectStatus']) => void;
  setVersionPlan: (plan: VersionPlan | null) => void;
  setSelectedElement: (el: ElementInfo | null) => void;
  setElementInfo: (info: ElementSelectResult['elementInfo'] | null) => void;
  setProcessing: (v: boolean) => void;
  setThinkingText: (v: string | null) => void;
  setDevTaskRunning: (v: boolean) => void;
  setAutoTestRunning: (v: boolean) => void;
  setAutoTestLatestProgress: (text: string | null) => void;
  setLastTestSummary: (text: string | null) => void;
  appendDevProgress: (line: string) => void;
  clearDevProgress: () => void;
  pushMessage: (
    msg: Omit<ChatMessageUI, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
  ) => void;
  clearMessages: () => void;
  loadHistory: (projectId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  /** 停止当前 AI 任务（中断 dsh 子进程） */
  stopTask: () => Promise<void>;
}

let msgSeq = 0;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isProcessing: false,
  thinkingText: null,
  devTaskRunning: false,
  autoTestRunning: false,
  autoTestLatestProgress: null,
  lastTestSummary: null,
  devProgress: [],
  currentProjectId: null,
  requirements: null,
  projectStatus: null,
  versionPlan: null,
  selectedElement: null,
  elementInfo: null,

  setProject: (id) =>
    set({
      currentProjectId: id,
      requirements: null,
      projectStatus: null,
      versionPlan: null,
      selectedElement: null,
      elementInfo: null,
      isProcessing: false,
      thinkingText: null,
      devTaskRunning: false,
      autoTestRunning: false,
      autoTestLatestProgress: null,
      lastTestSummary: null,
      devProgress: [],
    }),
  setRequirements: (req) => set({ requirements: req }),
  setProjectStatus: (status) => set({ projectStatus: status }),
  setVersionPlan: (plan) => set({ versionPlan: plan }),
  setSelectedElement: (el) => set({ selectedElement: el }),
  setElementInfo: (info) => set({ elementInfo: info }),
  setProcessing: (v) => set({ isProcessing: v }),
  setThinkingText: (v) => set({ thinkingText: v }),
  setDevTaskRunning: (v) => set({ devTaskRunning: v }),
  setAutoTestRunning: (v) => set({ autoTestRunning: v }),
  setAutoTestLatestProgress: (text) => set({ autoTestLatestProgress: text }),
  setLastTestSummary: (text) => set({ lastTestSummary: text }),
  appendDevProgress: (line) =>
    set((s) => ({ devProgress: [...s.devProgress.slice(-40), line] })),
  clearDevProgress: () => set({ devProgress: [] }),

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
          reasoning: m.reasoning,
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
        const obj =
          raw && typeof raw === 'object' && 'code' in raw
            ? (raw as { code?: string; message?: unknown })
            : null;
        const message =
          typeof raw === 'string'
            ? raw
            : obj && typeof obj.message === 'string'
              ? obj.message
              : '发送失败，请重试';
        // 未接入大模型 API：弹出配置弹窗引导接入（与"发送前守卫"一致）
        if (obj?.code === 'API_KEY_MISSING') {
          useUiStore.getState().openSettings();
        }
        pushMessage({ role: 'system', content: message });
        set({ isProcessing: false, thinkingText: null });
      }
      // 回复经 chat:response 事件到达（useChatEvents），成功路径由 done 事件复位
    } catch (err) {
      const message =
        typeof err === 'object' && err !== null && 'error' in err
          ? String((err as { error: { message: string } }).error.message)
          : '发送失败，请重试';
      pushMessage({ role: 'system', content: message });
      set({ isProcessing: false, thinkingText: null });
    }
  },

  stopTask: async () => {
    const { currentProjectId, pushMessage } = get();
    if (!currentProjectId) return;
    await window.electron.chat.stop({ projectId: currentProjectId }).catch(() => undefined);
    pushMessage({ role: 'system', content: '⏹ 已停止生成' });
    set({ isProcessing: false, thinkingText: null });
  },
}));
