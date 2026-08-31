/**
 * 对话状态（Zustand）。
 * 与主进程通过 chat:send / chat:response / chat:signal / chat:history 通信。
 */
import { create } from 'zustand';
import type {
  RequirementSummary,
  VersionPlan,
  ProjectStatus,
  StructuredTestReport,
  AutoTestPlanStep,
  AutoTestPlanSummary,
} from '@shared/types/project';
import type { ElementInfo, ElementSelectResult } from '@shared/types/preview';
import { useUiStore } from './ui';

/** 默认的 5 步测试计划（与 src/main/dsh/prompt.ts buildAutoTestTask 对齐） */
export const DEFAULT_AUTO_TEST_PLAN: AutoTestPlanStep[] = [
  {
    key: 'inspect',
    title: '检查文件齐全',
    description: '确认 index.html / style.css / app.js 等文件齐全、结构合理',
  },
  {
    key: 'write-tests',
    title: '编写测试用例',
    description: '根据需求编写可执行的测试用例，覆盖核心功能与关键流程',
  },
  {
    key: 'run-checks',
    title: '运行检查',
    description: '用 bash 实际运行可行的检查（语法、启动、冒烟测试等）',
  },
  {
    key: 'audit-code',
    title: '审计代码',
    description: '检查明显 bug、逻辑漏洞、安全风险（XSS / 注入 / 硬编码密钥等）',
  },
  {
    key: 'summary',
    title: '输出报告',
    description: '汇总所有检查结果，输出结构化测试报告',
  },
];

/** 默认测试总时长估计（冒烟实测 ~14s，这里留 1.7x 安全裕度） */
export const DEFAULT_AUTO_TEST_EXPECTED_MS = 25_000;

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
  /**
   * 最近一次自动测试的结构化报告（用于完成态分流：pass/warn/block + 问题清单）。
   * 解析失败时 verdict='warn'，issues=[]，fullReport=原文。
   */
  lastTestReport: StructuredTestReport | null;
  /** 自动测试计划步骤（进行中才有值）；UI 依据它渲染进度列表 */
  autoTestPlan: AutoTestPlanStep[] | null;
  /** 当前进行的步骤索引：-1 未开始 / 0-4 进行中或已完成 */
  autoTestCurrentStep: number;
  /** 当前测试开始的 ms 时间戳（Date.now）；用于计算已用时 */
  autoTestStartedAt: number | null;
  /** 估算测试总时长（毫秒）；初次默认 25s，后续从 lastSummary 学习 */
  autoTestExpectedDurationMs: number;
  /** 当前测试累计的工具调用次数（用于步骤推断） */
  autoTestToolCount: number;
  /** 最近一次工具调用可读文案（toolProgressLabel 输出），用于卡片底部展示 */
  autoTestLatestToolLabel: string | null;
  /** 最近一次完成的耗时摘要（用于完成后聊天历史的系统消息） */
  autoTestLastSummary: AutoTestPlanSummary | null;
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
  setLastTestReport: (report: StructuredTestReport | null) => void;
  setAutoTestPlan: (plan: AutoTestPlanStep[] | null) => void;
  setAutoTestCurrentStep: (step: number) => void;
  setAutoTestStartedAt: (ts: number | null) => void;
  setAutoTestExpectedDurationMs: (ms: number) => void;
  setAutoTestToolCount: (n: number) => void;
  setAutoTestLatestToolLabel: (label: string | null) => void;
  setAutoTestLastSummary: (summary: AutoTestPlanSummary | null) => void;
  resetAutoTestPlan: () => void;
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
  lastTestReport: null,
  autoTestPlan: null,
  autoTestCurrentStep: -1,
  autoTestStartedAt: null,
  autoTestExpectedDurationMs: DEFAULT_AUTO_TEST_EXPECTED_MS,
  autoTestToolCount: 0,
  autoTestLatestToolLabel: null,
  autoTestLastSummary: null,
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
      lastTestReport: null,
      autoTestPlan: null,
      autoTestCurrentStep: -1,
      autoTestStartedAt: null,
      autoTestToolCount: 0,
      autoTestLatestToolLabel: null,
      // 跨项目隔离：避免上一个项目的耗时摘要 / 估算时长污染新项目
      // （学习过往时长的能力交由聊天历史里的「测试计划已完成」系统消息自行扫描，本轮不跨项目）
      autoTestLastSummary: null,
      autoTestExpectedDurationMs: DEFAULT_AUTO_TEST_EXPECTED_MS,
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
  setLastTestReport: (report) => set({ lastTestReport: report }),
  setAutoTestPlan: (plan) => set({ autoTestPlan: plan }),
  setAutoTestCurrentStep: (step) => set({ autoTestCurrentStep: step }),
  setAutoTestStartedAt: (ts) => set({ autoTestStartedAt: ts }),
  setAutoTestExpectedDurationMs: (ms) => set({ autoTestExpectedDurationMs: ms }),
  setAutoTestToolCount: (n) => set({ autoTestToolCount: n }),
  setAutoTestLatestToolLabel: (label) => set({ autoTestLatestToolLabel: label }),
  setAutoTestLastSummary: (summary) => set({ autoTestLastSummary: summary }),
  resetAutoTestPlan: () =>
    set({
      autoTestPlan: null,
      autoTestCurrentStep: -1,
      autoTestStartedAt: null,
      autoTestToolCount: 0,
      autoTestLatestToolLabel: null,
      autoTestRunning: false,
      autoTestLatestProgress: null,
    }),
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
