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
  /**
   * v3.2.1 P2-18：消息元数据，用于来源追踪与清理。
   * - sessionId：消息所属「会话/流程」标识（如 "deploy-assistant-${projectId}-${sessionKey}"）。
   *   切换项目或主动关闭流程时，调用方可通过 sessionId 批量清理该流程的残留消息，
   *   避免消息流混入旧项目的助手消息造成认知混乱。
   */
  metadata?: {
    sessionId?: string;
    /** 消息来源通道（如 'deploy-assistant' / 'auto-test' / 'main-chat'） */
    channel?: string;
    /**
     * 修复 P0-4：选中元素上下文。消息携带此字段时，Message.tsx 渲染"关于 [元素]"角标，
     * 让用户能识别"这条消息是关于哪个 UI 元素的"——避免 DraggableChat / ElementInspector
     * 双输入框跨场景时上下文串台造成的认知混乱。
     * - description：来自 ElementInfo 的可读描述（如"主提交按钮"）
     * - tag：HTML 标签（button / div / span）
     * - selector：选择器（用于去重 / 调试，不直接展示）
     */
    contextElement?: {
      description: string;
      tag: string;
      selector: string;
    };
  };
}

/** 重新进入中途项目时的进度引导（AI 助理汇报进度 + 继续下一步）。
 * v0.1.02 P3-AUDIT：区分 user 主动重测（'auto-test'，重置失败计数）与
 * InterruptBanner 自动倒计时触发的内部重试（'auto-test-retry'，保留失败计数，否则指数退避的 3 次上限永远到不了）。
 */
export type ResumeAction =
  | 'confirm-requirements'
  | 'confirm-plan'
  | 'goto-preview'
  | 'goto-chat'
  | 'refresh-status'
  | 'open-browser'
  | 'auto-test'
  | 'auto-test-retry'
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
  /**
   * 测试被中断提示横幅：主进程推送 signal.type='error' 且 autoTestRunning=true 时出现，
   * AssistantPanel 据此渲染 amber banner + 倒计时自动重试入口。
   * - reason：信号文案（透传给用户）
   * - retryAt：自动重试的 ms 时间戳（Date.now()+指数退避）。
   *   v0.1.02 P0-3：传 null 表示「已达重试上限，请手动重试」，banner 取消倒计时。
   */
  interruptBanner: { reason: string; retryAt: number | null } | null;
  /**
   * v0.1.02 P0-3：自动测试连续失败的累计次数。
   * - 每次收到 error 信号且 autoTestRunning=true 时 +1
   * - 触发自动重试（AssistantPanel 倒计时到点）或测试成功完成时清零
   * - 累计达到 3 次后停止自动重试，banner 显示「请手动重试」
   * 同一项目的连续失败计数；切换项目时重置。
   */
  autoTestRetryCount: number;
  /**
   * 最近一次「一键修复」指令发出的时间戳（ms）。
   * 由 App.tsx 的 onSendModifyFix 在发送 buildFixInstruction/buildSingleFixInstruction 时设置。
   * AssistantPanel 据此渲染 SuggestRetestCard（30s 窗口内 + verdict≠pass + 不在处理中时显示）。
   */
  lastTestFixAt: number | null;
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
  /**
   * 设置测试中断提示横幅（reason 透传 DSH 信号文案；retryAt 为自动重试时间戳）。
   * banner 显示期间由 AssistantPanel 内的 useEffect 倒计时触发 onAction('auto-test')。
   * v0.1.02 P0-3：retryAt 允许为 null，表示「已达重试上限，请手动重试」。
   */
  setInterruptBanner: (banner: { reason: string; retryAt: number | null } | null) => void;
  /**
   * v0.1.02 P0-3：自增自动测试失败计数。AssistantPanel 触发自动重试或用户手动重试时调用。
   * 暴露为单独 action 便于在 useChatEvents 中精确控制（不是单纯 set，复用现有调用点）。
   */
  incrementAutoTestRetry: () => void;
  /**
   * v0.1.02 P0-3：清零自动测试失败计数。测试成功完成或用户手动触发重置时调用。
   */
  resetAutoTestRetry: () => void;
  /**
   * 设置最近一次"一键修复"指令时间戳；AssistantPanel 据此渲染 SuggestRetestCard。
   * 传 null 表示「稍后」按钮主动关闭提示卡。
   */
  setLastTestFixAt: (ts: number | null) => void;
  resetAutoTestPlan: () => void;
  appendDevProgress: (line: string) => void;
  clearDevProgress: () => void;
  /**
   * 从 localStorage 恢复指定项目的历史开发日志。
   * 切项目时由 setProject 内部调用，让「💬 开发日志」Tab 在重新打开项目后
   * 还能看到上一会话的 DSH 工具调用过程，而不是空白。
   * 解析失败 / 数据为空时静默保持当前 devProgress 不变（不污染）。 */
  loadDevProgress: (projectId: string) => void;
  /**
   * 把当前 devProgress 写到 localStorage（key 形如 freecoder.devProgress.{projectId}）。
   * appendDevProgress 内部会自动调一次，调用方一般不用直接调。
   * localStorage 抛错（隐私模式 / 容量满）时静默失败，不影响主流程。 */
  persistDevProgress: () => void;
  pushMessage: (
    msg: Omit<ChatMessageUI, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
  ) => void;
  clearMessages: () => void;
  /**
   * v3.2.1 P2-18：按 metadata.sessionId / channel 清理消息。
   * 用于切换项目或关闭流程时清理该流程残留的助手消息，避免旧项目消息混入新项目。
   * - sessionId：精确匹配 metadata.sessionId（推荐用法，如 `deploy-assistant-{projectId}-{sessionKey}`）
   * - channel：模糊匹配 metadata.channel 前缀（用于批量清理同通道的所有 session，如清掉所有 'deploy-assistant' 消息）
   * 二者传空则 noop；都不传时建议改用 clearMessages()。
   */
  cleanMessagesBySession: (filter: { sessionId?: string; channel?: string }) => void;
  loadHistory: (projectId: string) => Promise<void>;
  /**
   * 发送一条用户消息到主进程。
   * v0.1.02 P1-4：options.selectedElement 用于临时覆盖 store 中的 selectedElement（如 ElementInspector
   * 内的 MiniChat 直接传入选中元素，避免依赖 store 全局状态）。不传时使用 store 的 selectedElement。
   */
  sendMessage: (text: string, options?: {
      /**
       * 修复 P0-4：临时覆盖 store.selectedElement（ElementInspector 内嵌 MiniChat 专用，
       * 不修改全局 store，避免污染 DraggableChat 的元素上下文）。同时在 push 的用户消息
       * 里携带 metadata.contextElement，让 Message.tsx 在气泡上渲染"关于 [元素]"角标。
       */
      selectedElement?: ElementInfo;
      /**
       * 修复 P0-4：消息 metadata 透传。ElementInspector 调用时附 contextElement 即可。
       * 默认 undefined → 走原有 pushMessage 路径，不会自动给每个用户消息加角标。
       */
      metadata?: ChatMessageUI['metadata'];
    }) => Promise<void>;
  /** 停止当前 AI 任务（中断 dsh 子进程） */
  stopTask: () => Promise<void>;
  /**
   * v3.2.2 P0-5：取消指定项目上的所有后台任务（开发 / 导出 / 打包）。
   * 由 App.tsx 在 currentProjectId 变化时调用上一个 projectId，避免旧项目的
   * 后台任务继续烧 token / CPU / 磁盘。三个 IPC 并发调用，任一失败不影响其他。
   */
  cancelActiveTasks: (projectId: string) => Promise<void>;
}

let msgSeq = 0;

/** 开发日志持久化：localStorage key 前缀 + 完整 key 构造。
 * 用项目 ID 分桶，互不污染；卸载 App 后仍可恢复，避免「💬 开发日志」Tab 一打开就空。 */
const DEV_PROGRESS_STORAGE_PREFIX = 'freecoder.devProgress.';

function devProgressStorageKey(projectId: string): string {
  return `${DEV_PROGRESS_STORAGE_PREFIX}${projectId}`;
}

/** 安全从 localStorage 读取 JSON 数组。任何抛错（隐私模式 / 容量满 / JSON 损坏）都返回 null，
 * 配合调用方"读不到就保持现状"的语义，避免一个空日志把 store 整个重置成 []。 */
function readDevProgressFromStorage(projectId: string): string[] | null {
  try {
    const raw = localStorage.getItem(devProgressStorageKey(projectId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // 防御性过滤：只保留字符串项，避免历史脏数据污染
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return null;
  }
}

/** 安全写入 localStorage。抛错时静默失败（开发日志丢一条不能阻塞整个 DSH 流）。 */
function writeDevProgressToStorage(projectId: string, lines: string[]): void {
  try {
    localStorage.setItem(devProgressStorageKey(projectId), JSON.stringify(lines));
  } catch {
    /* 隐私模式 / 容量满：忽略，下一轮 append 会再试 */
  }
}

/** 安全删除 localStorage 条目。 */
function removeDevProgressFromStorage(projectId: string): void {
  try {
    localStorage.removeItem(devProgressStorageKey(projectId));
  } catch {
    /* 忽略 */
  }
}

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
  interruptBanner: null,
  lastTestFixAt: null,
  // v0.1.02 P0-3：自动测试连续失败计数，0 表示正常；切项目/成功完成时清零
  autoTestRetryCount: 0,

  setProject: (id) => {
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
      interruptBanner: null,
      lastTestFixAt: null,
      // v0.1.02 P0-3：跨项目隔离失败计数
      autoTestRetryCount: 0,
    });
    // v0.1.02 P1-6：项目切换时同步重置 ui store 的 aiChatHidden，
    // 避免上一个项目的"🔍 元素 Tab + 选中元素 → 浮窗隐藏"状态污染新项目。
    // 不在这里重置，新项目的 chat 视图一开始浮窗仍是隐藏的（验收报告 P1-6）。
    useUiStore.getState().setAiChatHidden(false);
    // v3.2.1 P2-1：项目切换时同步清空全局聊天草稿，避免上一个项目写到一半的输入
    // 被带入新项目（验收报告 P2-1：UI store 缺少项目维度的草稿隔离）。
    // chatDraft 设计为同一项目内跨视图共享（chat ↔ preview），不应跨项目残留。
    useUiStore.getState().clearChatDraft();
    // 切到新项目后立刻从 localStorage 恢复「💬 开发日志」Tab 的历史内容。
    // 必须放在 set({...}) 之后（devProgress 先被清到 []），再异步覆盖，
    // 这样用户切回项目时，开发日志 Tab 不会立刻显示"暂无开发记录"。
    // 读不到 / 解析失败时静默保留 []（与 setProject 测试期望保持一致）。
    if (id) get().loadDevProgress(id);
  },
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
  setInterruptBanner: (banner) => set({ interruptBanner: banner }),
  setLastTestFixAt: (ts) => set({ lastTestFixAt: ts }),
  // v0.1.02 P0-3：自动测试失败计数器自增
  incrementAutoTestRetry: () => set((s) => ({ autoTestRetryCount: s.autoTestRetryCount + 1 })),
  // v0.1.02 P0-3：清零自动测试失败计数器（成功完成 / 用户手动重置时调用）
  resetAutoTestRetry: () => set({ autoTestRetryCount: 0 }),
  resetAutoTestPlan: () =>
    set({
      autoTestPlan: null,
      autoTestCurrentStep: -1,
      autoTestStartedAt: null,
      autoTestToolCount: 0,
      autoTestLatestToolLabel: null,
      autoTestRunning: false,
      autoTestLatestProgress: null,
      // 同步清掉中断横幅，避免测试完成后残留旧 reason
      interruptBanner: null,
      // 同步清掉最近修复时间戳，避免跨次测试误导 SuggestRetestCard
      lastTestFixAt: null,
      // v3.2.1 P2-11：同时清掉旧报告，避免新一轮测试启动时还展示上一次的报告
      // （中途刷新页面 / 切项目再切回也会有"旧报告残留"的认知干扰）
      lastTestReport: null,
      // 注意：autoTestLastSummary / autoTestExpectedDurationMs 不在这里清掉。
      // 它们的生命周期是"上一个测试周期 → 学习预估"，由 setProject 跨项目切换时清掉
      // （避免上一个项目的耗时被带入新项目）。同一项目内重跑测试时保留它们，
      // AutoTestPlanCard 才会基于"上一轮跑了多久"动态调整预估。
      // v3.2.1 P2-11 之前曾在这里清掉，结果导致同一项目内反复跑测试时预估永远停在 25s，
      // 不再有"越跑越准"的学习效果，已回退。
      // 注意：autoTestRetryCount 的清零走独立的 resetAutoTestRetry action。
      // 把它塞到这里会导致 error 分支里的 incrementAutoTestRetry 被反向重置，
      // 失败计数永远停在 1，无法触发 3 次上限（v0.1.02 P0-3 实测坑）。
      // success 分支已在 useChatEvents 的 'message' 回调里显式调 resetAutoTestRetry。
    }),
  appendDevProgress: (line) => {
    // 追加一条 + 自动持久化到 localStorage。
    // 注意：appendDevProgress 内部已经会切到 slice(-40)，持久化时也按这个长度写，
    // 保证 store 与 localStorage 长度一致，下次启动不会出现"内存比持久化多很多"的回填截断。
    const nextLines = (() => {
      const cur = get().devProgress;
      const next = [...cur.slice(-40), line];
      return next.length > 40 ? next.slice(-40) : next;
    })();
    set({ devProgress: nextLines });
    // 持久化失败时静默，不影响开发日志实时显示。
    const pid = get().currentProjectId;
    if (pid) writeDevProgressToStorage(pid, nextLines);
  },
  clearDevProgress: () => {
    set({ devProgress: [] });
    // 同时清掉当前项目在 localStorage 里的日志条目，避免下次 loadDevProgress 又回填。
    const pid = get().currentProjectId;
    if (pid) removeDevProgressFromStorage(pid);
  },
  loadDevProgress: (projectId) => {
    if (!projectId) return;
    const restored = readDevProgressFromStorage(projectId);
    if (restored === null) return;
    // 截到与 appendDevProgress 同步的最大长度（40），避免历史脏数据一次性塞太多。
    const trimmed = restored.length > 40 ? restored.slice(-40) : restored;
    set({ devProgress: trimmed });
  },
  persistDevProgress: () => {
    const pid = get().currentProjectId;
    if (!pid) return;
    writeDevProgressToStorage(pid, get().devProgress);
  },

  pushMessage: (msg) => {
    // v3.2.1 P2-15：去重 + 限流。
    // - 连续 3 条同 role + 同 content 的系统消息跳过（避免相同内容反复刷屏）：
    //   实测"自动测试进行中"等高频信号偶发重复 push 3-5 次，影响可读性。
    // - 同 channel + 同前缀（content 前 16 字符）在 1.5s 窗口内重复出现也跳过，
    //   防止主进程 / preload 在快速重试时刷出多条近乎相同的提示。
    // - 用户消息和助手消息不去重（用户可能真发重复消息；助手消息是真实流）。
    // - 带 sessionId 的消息不参与去重（清理靠 cleanMessagesBySession，自身不该被吞）。
    const last = get().messages;
    const tail = last.slice(-3);
    if (msg.role === 'system' && !msg.metadata?.sessionId) {
      const dupCount = tail.filter(
        (m) => m.role === 'system' && m.content === msg.content,
      ).length;
      if (dupCount >= 2) {
        // 已有 ≥2 条相同 → 这是第 3+ 次重复，跳过
        return;
      }
      // 同 channel + 同前缀 1.5s 内限流
      const channel = msg.metadata?.channel;
      const prefix = msg.content.slice(0, 16);
      const now = Date.now();
      // 兼容 ES2021-：从尾部向前扫最多 10 条，命中即停
      let recentDup: ChatMessageUI | undefined;
      for (let i = last.length - 1; i >= Math.max(0, last.length - 10); i--) {
        const m = last[i];
        if (
          m.role === 'system' &&
          m.metadata?.channel === channel &&
          m.content.slice(0, 16) === prefix &&
          now - new Date(m.timestamp).getTime() < 1500
        ) {
          recentDup = m;
          break;
        }
      }
      if (recentDup) return;
    }
    msgSeq += 1;
    const full: ChatMessageUI = {
      ...msg,
      id: msg.id ?? `local-${msgSeq}`,
      timestamp: msg.timestamp ?? new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, full] }));
  },

  clearMessages: () => set({ messages: [] }),

  cleanMessagesBySession: (filter) => {
    const { sessionId, channel } = filter;
    if (!sessionId && !channel) return;
    set((s) => ({
      messages: s.messages.filter((m) => {
        const meta = m.metadata;
        if (!meta) return true; // 无 metadata 的消息（用户/主进程早期推送）保留
        if (sessionId && meta.sessionId === sessionId) return false;
        if (channel && meta.channel === channel && !sessionId) return false;
        return true;
      }),
    }));
  },

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

  sendMessage: async (text, options) => {
    const { currentProjectId, pushMessage, selectedElement } = get();
    const trimmed = text.trim();
    if (!trimmed || !currentProjectId) return;

    // API 配置未知或未配置：弹出配置引导（与 DeepSeek Harness 一致），不发送
    const { apiKeyConfigured, openSettings } = useUiStore.getState();
    if (apiKeyConfigured !== true) {
      openSettings();
      return;
    }

    pushMessage({ role: 'user', content: trimmed, metadata: options?.metadata });
    set({ isProcessing: true });

    // v0.1.02 P1-4：options.selectedElement 优先级 > store.selectedElement。
    // 这样 ElementInspector 内的 MiniChat 即使 store 里 selectedElement 已被清掉，
    // 也能带上元素上下文（验收报告 P1-4）。
    const effectiveSelectedElement = options?.selectedElement ?? selectedElement;

    try {
      const result = await window.electron.chat.send({
        projectId: currentProjectId,
        message: trimmed,
        selectedElement: effectiveSelectedElement ?? undefined,
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
    const { currentProjectId, pushMessage, autoTestRunning } = get();
    if (!currentProjectId) return;
    await window.electron.chat.stop({ projectId: currentProjectId }).catch(() => undefined);
    pushMessage({ role: 'system', content: '⏹ 已停止生成' });
    set({ isProcessing: false, thinkingText: null });
    // v3.2.1 P2-12 补强：自动测试进行中点"立即中断"时，同步复位运行态，
    // 否则 AutoTestPlanCard 会继续渲染"进行中"步骤指示器，用户以为中断没生效。
    // 注意：必须复用 resetAutoTestPlan（含清 interruptBanner / lastTestReport / lastTestFixAt）
    // 否则中断态横幅会残留，但该函数又必须保留 autoTestLastSummary / autoTestExpectedDurationMs
    // （学习预估需要历史摘要），所以不能粗暴 set 多字段——直接调 action 是最稳的写法。
    if (autoTestRunning) {
      get().resetAutoTestPlan();
    }
  },

  // v3.2.2 P0-5：并发取消旧项目的所有后台任务（开发 / 导出 / 打包）。
  // 任一 IPC 失败不影响其他（Promise.allSettled），只 warn 不 throw，避免切项目流程被中断。
  cancelActiveTasks: async (projectId) => {
    if (!projectId) return;
    await Promise.allSettled([
      window.electron.project.cancelDevelopment({ projectId }).catch((err) => {
        console.warn(`[FreeCoder] 取消开发任务失败（${projectId}）：`, err);
      }),
      window.electron.export.cancel({ projectId }).catch((err) => {
        console.warn(`[FreeCoder] 取消导出任务失败（${projectId}）：`, err);
      }),
      window.electron.package.cancel({ projectId }).catch((err) => {
        console.warn(`[FreeCoder] 取消打包任务失败（${projectId}）：`, err);
      }),
    ]);
  },
}));
