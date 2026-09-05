import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { ResumeGuide, ResumeAction } from '../../store/chat';
import { useUiStore } from '../../store/ui';
import type { ElementInfo, ElementSelectResult } from '@shared/types/preview';
import type {
  StructuredTestReport,
  TestIssue,
  TestVerdict,
  AutoTestPlanStep,
  AutoTestPlanSummary,
} from '@shared/types/project';
import ElementInspector from './ElementInspector';
import DevLog from '../DevLog';
import AutoTestPlanCard from '../Chat/AutoTestPlanCard';
import AutoTestSummaryCard from '../Chat/AutoTestSummaryCard';
import { formatDuration } from '../Chat/autoTestProgress';
import AiAssistantIcon from '../AiAssistantIcon';
import InterruptBanner from './InterruptBanner';

interface AssistantPanelProps {
  /** 项目进度引导（项目恢复 / 继续下一步 / 自动测试进度等） */
  resumeGuide?: ResumeGuide | null;
  onResumeAction: (action: ResumeAction) => void;
  /** 一键自动测试进行中（浮窗自动展开并切到「进度」Tab） */
  autoTestRunning?: boolean;
  /** 自动测试最近一条进度文本 */
  autoTestLatestProgress?: string | null;
  /** 自动测试 5 步计划（进行中传值） */
  autoTestPlan?: AutoTestPlanStep[] | null;
  /** 自动测试当前步骤（-1 未开始 / 0-4） */
  autoTestCurrentStep?: number;
  /** 自动测试开始时间戳（ms） */
  autoTestStartedAt?: number | null;
  /** 自动测试估算总时长（ms） */
  autoTestExpectedDurationMs?: number;
  /** 最近一次工具调用可读文案 */
  autoTestLatestToolLabel?: string | null;
  /** 最近一次测试完成的耗时摘要（完成后传值） */
  autoTestLastSummary?: AutoTestPlanSummary | null;
  /** 预览中选中的元素（null 时 🔍 Tab 显示引导文案） */
  selectedElement?: ElementInfo | null;
  /** 选中元素的结构化信息 */
  elementInfo?: ElementSelectResult['elementInfo'] | null;
  /** 是否正在处理 AI 回复（传给 ElementInspector 用于按钮 busy 态） */
  isProcessing?: boolean;
  /** 元素修改指令发送（保留兼容；当前 ElementInspector 内部已自带 MiniChat） */
  onSendModify?: (instruction: string) => void;
  /**
   * 测试报告「一键修复」指令发送：与 onSendModify 的语义边界
   * - onSendModify：元素修改（ElementInspector MiniChat），不计入「修复完成时间」
   * - onSendModifyFix：报告卡片主按钮 + 单条问题「修复」，会同步更新 chat store 的 lastTestFixAt
   *   用于 AssistantPanel 在 AI 回复结束后渲染「建议再测一次」提示卡（30s 窗口）。
   */
  onSendModifyFix?: (instruction: string) => void;
  /**
   * 最近一次「一键修复」指令发出的时间戳（ms），传 0/null 表示无。
   * 与 lastTestReport.verdict + autoTestRunning + isProcessing 共同决定 SuggestRetestCard 是否渲染。
   */
  lastTestFixAt?: number | null;
  /** 主动关闭「建议再测一次」提示卡（用户点了「稍后」） */
  clearSuggestRetest?: () => void;
  /** 开发日志（DSH 工具调用与结果流） */
  devProgress?: string[];
  /** 最近一次自动测试的结构化报告（用于完成态分流 + 问题清单） */
  lastTestReport?: StructuredTestReport | null;
  /** 查看完整测试报告（切到 chat 视图看报告消息） */
  onViewReport?: () => void;
  /** 打开部署面板（用于完成态卡片的「去部署」按钮） */
  onOpenDeploy?: () => void;
  /**
   * 测试被中断时的 amber 横幅；reason 由 DSH 信号透传，retryAt 是自动重试时间戳。
   * 进度 Tab 顶部按此渲染 InterruptBanner；倒计时到点后自动派发 onResumeAction('auto-test')。
   * v0.1.02 P0-3：retryAt 可为 null，表示「已达重试上限，请手动重试」。
   */
  interruptBanner?: { reason: string; retryAt: number | null } | null;
  /** 主动清掉中断横幅（用户点了「取消」） */
  clearInterruptBanner?: () => void;
  /** v3.2.1 P1-6：自动测试连续失败次数（来自 chat store 的 autoTestRetryCount） */
  autoTestRetryCount?: number;
  /** v3.2.1 P2-12：测试 overtime 时卡片的"立即中断"按钮回调；不传则不渲染该按钮 */
  onStopAutoTest?: () => void;
  /**
   * 元素选择模式（开：悬停高亮+点击识别；关：正常交互测试）。
   * 由 App.tsx 维护，AssistantPanel 仅消费 + 把它放在「🔍 元素」Tab 顶部开关上。
   * PreviewContainer 也消费同一个值（用来同步给 webview 与渲染顶部提示横幅），
   * 所以统一由 App.tsx 持有是符合"唯一真源"原则的。 */
  selectMode?: boolean;
  /** 切换元素选择模式（开关按钮触发）。 */
  onToggleSelect?: () => void;
  /** 外部覆盖样式：用于把父容器的可拖动宽度（width）应用到根 aside */
  style?: CSSProperties;
  /** 外部追加 className：一般不需要，但预留口子方便父级布局定制 */
  className?: string;
}

type TabKey = 'progress' | 'element' | 'devlog';

/**
 * AI 助理右侧面板（preview 视图）：
 * - 与 chat 视图共享同一套 AI 助理聊天浮窗（DraggableChat，由 App.tsx 全局渲染）；
 *   切换【对话 ↔ 预览】时浮窗不卸载、不消失，位置/最小化状态/输入框内容均跨视图保持。
 * - 标题 + 3-Tab：📌 进度 / 🔍 元素 / 💬 开发日志
 * - 选中元素 → 切到 🔍 Tab；测试进行中 / 测试刚结束 → 切到 📌 Tab；其他情况停留在用户最后选择
 * - 进入 🔍 元素 Tab 且已选中元素时，通过 ui store 通知全局 AI 助理浮窗隐藏，
 *   避免与 ElementInspector 内部修改指令 MiniChat 形成两个输入框并存的认知负担。
 *   离开 🔍 Tab / 取消选中元素时浮窗自动恢复显示。
 */
export default function AssistantPanel({
  resumeGuide,
  onResumeAction,
  autoTestRunning = false,
  autoTestLatestProgress = null,
  autoTestPlan = null,
  autoTestCurrentStep = -1,
  autoTestStartedAt = null,
  autoTestExpectedDurationMs = 25_000,
  autoTestLatestToolLabel = null,
  autoTestLastSummary = null,
  selectedElement = null,
  elementInfo = null,
  isProcessing = false,
  onSendModify,
  onSendModifyFix,
  lastTestFixAt = null,
  clearSuggestRetest,
  devProgress = [],
  lastTestReport = null,
  onViewReport,
  onOpenDeploy,
  interruptBanner = null,
  clearInterruptBanner,
  /** v3.2.1 P1-6：自动测试连续失败次数，用于 InterruptBanner 展示「第 N/M 次重试」进度 */
  autoTestRetryCount = 0,
  /** v3.2.1 P2-12：测试 overtime 时卡片的"立即中断"按钮回调；不传则不渲染该按钮 */
  onStopAutoTest,
  /** 元素选择模式 + 切换回调：从 App.tsx 注入到「🔍 元素」Tab 顶部开关。
   * 默认值 false / 空函数，避免 AssistantPanel 单独被复用时没有 App 注入也能渲染。 */
  selectMode = false,
  onToggleSelect = () => undefined,
  style,
  className = '',
}: AssistantPanelProps) {
  const [tab, setTab] = useState<TabKey>('progress');
  const [pending, setPending] = useState<ResumeAction | null>(null);
  const [testJustFinished, setTestJustFinished] = useState(false);
  /** 记录用户已「看过」的 Tab，用于决定 Tab 标题角标显示 */
  const [seen, setSeen] = useState<Record<TabKey, boolean>>({
    progress: false,
    element: false,
    devlog: false,
  });

  /** 有新内容的 Tab（用于 Tab 标题角标提示） */
  const hasProgress = !!resumeGuide;
  const hasElement = !!selectedElement && !!elementInfo;
  const hasDevLog = devProgress.length > 0;

  // 选中元素 → 切到 🔍 Tab
  // 测试进行中 / 测试刚结束时都不抢切（避免打断用户看测试进度/结果）
  useEffect(() => {
    if (hasElement && !autoTestRunning && !testJustFinished) {
      setTab('element');
      setSeen((s) => ({ ...s, element: true }));
    }
  }, [hasElement, selectedElement?.selector, elementInfo?.description, autoTestRunning, testJustFinished]);

  // 测试进行中 → 切到 📌 Tab
  useEffect(() => {
    if (autoTestRunning) {
      setTab('progress');
      setSeen((s) => ({ ...s, progress: true }));
    }
  }, [autoTestRunning]);

  // 测试结束（true→false）：短暂标记「刚完成」，期间抑制元素自动抢切；
  // 同时确保停留在 📌 进度 Tab 让用户看到 ✅ 完成态
  const prevAutoTestRef = useRef(autoTestRunning);
  useEffect(() => {
    const prev = prevAutoTestRef.current;
    prevAutoTestRef.current = autoTestRunning;
    if (prev && !autoTestRunning) {
      setTestJustFinished(true);
      setTab('progress');
      const t = setTimeout(() => setTestJustFinished(false), 2000);
      return () => clearTimeout(t);
    }
  }, [autoTestRunning]);

  const act = (action: ResumeAction) => {
    setPending(action);
    onResumeAction(action);
    setTimeout(() => setPending(null), 1500);
  };

  const selectTab = (t: TabKey) => {
    setTab(t);
    setSeen((s) => ({ ...s, [t]: true }));
    // v0.1.02 P0-1：同步设置全局浮窗隐藏态，避免渲染窗口期双输入框并存。
    // 用户主动切 Tab 的场景下，必须在本帧完成 store 更新，
    // 否则 DraggableChat 会在 selectTab 调用后下一帧才接到 hidden=true。
    setAiChatHidden(t === 'element' && hasElement);
  };

  // Tab 按钮样式：active 与 inactive 都要有清晰可见的边框 + 明显不同的底色与字色。
  // 设计要点：
  // - inactive 用 border-slate-300 + bg-slate-100 让"未选"视觉下沉
  // - active 用 border-brand 2px 描边 + bg-white + text-brand 让"已选"明显凸起
  // - 配合 gap-1.5 让相邻 Tab 之间有 6px 间距，边框不会贴边糊成一条
  // - 三重区分（边框色 / 底色 / 字色）确保"哪个被选中"一眼可辨
  const tabClass = (t: TabKey) =>
    `flex-1 rounded-md border-2 py-1.5 transition-colors ${
      tab === t
        ? 'border-brand bg-white text-brand shadow-sm'
        : 'border-slate-300 bg-slate-100 text-slate-500 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700'
    }`;

  // 进入 🔍 元素 Tab 且已选中元素时，ElementInspector 内部已自带修改指令 MiniChat，
  // 此时通过 ui store 通知全局 AI 助理浮窗隐藏，避免两个输入框同时出现造成认知负担。
  // 切换到其他 Tab / 取消选中元素时恢复显示。
  // v0.1.02 P0-1：使用 useLayoutEffect 而非 useEffect，确保在浏览器绘制前同步更新 store，
  // 避免用户从其他 Tab 切到 🔍 元素时出现「双输入框共存一帧」的闪烁。
  const setAiChatHidden = useUiStore((s) => s.setAiChatHidden);
  const shouldHideAiChat = tab === 'element' && hasElement;
  useLayoutEffect(() => {
    setAiChatHidden(shouldHideAiChat);
  }, [shouldHideAiChat, setAiChatHidden]);

  return (
    <aside
      className={`flex h-full shrink-0 flex-col bg-slate-50 text-sm leading-relaxed text-slate-700 ${className}`.trim()}
      style={style}
    >
      {/* 标题 */}
      <div className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex items-center px-4 pt-3 pb-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <AiAssistantIcon size={16} className="shrink-0" withSparkle={false} />
            AI 助理
          </h3>
        </div>
        <div className="flex gap-1.5 px-3 pb-2">
          <button
            type="button"
            onClick={() => selectTab('progress')}
            className={tabClass('progress')}
          >
            📌 进度
            {hasProgress && !seen.progress && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
            )}
            {autoTestRunning && (
              <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 align-middle" />
            )}
          </button>
          <button
            type="button"
            onClick={() => selectTab('element')}
            className={tabClass('element')}
          >
            🔍 元素
            {hasElement && !seen.element && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
            )}
          </button>
          <button
            type="button"
            onClick={() => selectTab('devlog')}
            className={tabClass('devlog')}
          >
            💬 开发日志
            {hasDevLog && !seen.devlog && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
            )}
          </button>
        </div>
      </div>

      {/* Tab 内容区（可滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'progress' && (
          <ProgressTab
            resumeGuide={resumeGuide ?? null}
            autoTestRunning={autoTestRunning}
            autoTestLatestProgress={autoTestLatestProgress}
            autoTestPlan={autoTestPlan}
            autoTestCurrentStep={autoTestCurrentStep}
            autoTestStartedAt={autoTestStartedAt}
            autoTestExpectedDurationMs={autoTestExpectedDurationMs}
            autoTestLatestToolLabel={autoTestLatestToolLabel}
            autoTestLastSummary={autoTestLastSummary}
            lastTestReport={lastTestReport}
            pending={pending}
            onAction={act}
            onViewReport={onViewReport}
            onOpenDeploy={onOpenDeploy}
            onSendModifyFix={onSendModifyFix}
            lastTestFixAt={lastTestFixAt}
            clearSuggestRetest={clearSuggestRetest}
            isProcessing={isProcessing}
            interruptBanner={interruptBanner}
            clearInterruptBanner={clearInterruptBanner}
            // v3.2.1 P1-6：把连续失败次数透传给 ProgressTab，再传给 InterruptBanner 展示「第 N/3 次重试」徽章
            autoTestRetryCount={autoTestRetryCount}
            // v3.2.1 P2-12：透传 overtime 时的"立即中断"回调到 ProgressTab → AutoTestPlanCard
            onStopAutoTest={onStopAutoTest}
          />
        )}
        {tab === 'element' && (
          <ElementTab
            selectedElement={selectedElement}
            elementInfo={elementInfo}
            isProcessing={isProcessing}
            onSendModify={onSendModify}
            selectMode={selectMode}
            onToggleSelect={onToggleSelect}
          />
        )}
        {tab === 'devlog' && <DevLog lines={devProgress} />}
      </div>
    </aside>
  );
}

/* ========== 各 Tab 子组件 ========== */

function ProgressTab({
  resumeGuide,
  autoTestRunning,
  autoTestLatestProgress,
  autoTestPlan,
  autoTestCurrentStep,
  autoTestStartedAt,
  autoTestExpectedDurationMs,
  autoTestLatestToolLabel,
  autoTestLastSummary,
  lastTestReport,
  pending,
  onAction,
  onViewReport,
  onOpenDeploy,
  onSendModifyFix,
  lastTestFixAt,
  clearSuggestRetest,
  isProcessing,
  interruptBanner,
  clearInterruptBanner,
  // v3.2.1 P1-6：把连续失败次数透传给 InterruptBanner，渲染「第 N/3 次重试」徽章
  autoTestRetryCount,
  // v3.2.1 P2-12：overtime 时「立即中断」回调透传到 AutoTestPlanCard
  onStopAutoTest,
}: {
  resumeGuide: ResumeGuide | null;
  autoTestRunning: boolean;
  autoTestLatestProgress: string | null;
  autoTestPlan: AutoTestPlanStep[] | null;
  autoTestCurrentStep: number;
  autoTestStartedAt: number | null;
  autoTestExpectedDurationMs: number;
  autoTestLatestToolLabel: string | null;
  autoTestLastSummary: AutoTestPlanSummary | null;
  lastTestReport: StructuredTestReport | null;
  pending: ResumeAction | null;
  onAction: (a: ResumeAction) => void;
  onViewReport?: () => void;
  onOpenDeploy?: () => void;
  onSendModifyFix?: (instruction: string) => void;
  lastTestFixAt: number | null;
  clearSuggestRetest?: () => void;
  isProcessing: boolean;
  // v0.1.02 P0-3：interruptBanner 可为 null（AssistantPanelProps 默认 null）
  interruptBanner: { reason: string; retryAt: number | null } | null;
  clearInterruptBanner?: () => void;
  autoTestRetryCount: number;
  onStopAutoTest?: () => void;
}) {
  // 修复完成衔接：测试未在跑 + 有报告 + verdict≠pass + 最近 30 秒内有修复指令 + AI 不在处理中
  // 提示卡显示在 InterruptBanner 之下、TestReportCard 之上，确保用户先看得到「要不要再测一次」
  const showSuggestRetest = shouldShowSuggestRetest({
    autoTestRunning,
    lastTestReport,
    lastTestFixAt,
    isProcessing,
  });

  // 测试完成态：autoTestRunning=false 且存在结构化报告时优先展示 ✅/⚠️/❌ 完成态
  if (!autoTestRunning && lastTestReport) {
    return (
      <div className="space-y-3">
        {interruptBanner && (
          <InterruptBanner
            banner={interruptBanner}
            // v3.2.1 P1-6：把连续失败次数传给横幅，渲染「第 N/3 次重试」徽章
            retryIndex={autoTestRetryCount}
            retryTotal={3}
            onRetry={() => onAction('auto-test')}
            // v0.1.02 P3-AUDIT：自动倒计时路径不重置失败计数，让 P0-3 的 3 次上限生效
            onAutoRetry={() => onAction('auto-test-retry')}
            onCancel={clearInterruptBanner ?? (() => undefined)}
          />
        )}
        {showSuggestRetest && lastTestFixAt && (
          <SuggestRetestCard
            lastTestFixAt={lastTestFixAt}
            onAction={onAction}
            onClear={clearSuggestRetest ?? (() => undefined)}
          />
        )}
        <TestReportCard
          report={lastTestReport}
          resumeGuide={resumeGuide}
          pending={pending}
          onAction={onAction}
          onViewReport={onViewReport}
          onOpenDeploy={onOpenDeploy}
          onSendModifyFix={onSendModifyFix}
        />
        {autoTestLastSummary && (
          <AutoTestSummaryCard
            summary={autoTestLastSummary}
            dataTestid="fc-assistant-auto-test-summary"
          />
        )}
      </div>
    );
  }

  if (!resumeGuide) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
        📌 暂无进度引导
        <br />
        <span className="mt-1 block">项目状态稳定时不会出现引导</span>
      </div>
    );
  }
  const buttons = resumeGuide.actions && resumeGuide.actions.length > 0 ? resumeGuide.actions : null;
  return (
    // v0.1.02 P3-2：进度引导容器添加 aria-live="polite"，让屏幕阅读器朗读
    // 自动测试进度 / 中断横幅 / 下一步按钮变化等关键状态变更。
    <div
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-slate-700"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {interruptBanner && (
        <InterruptBanner
          banner={interruptBanner}
          // v3.2.1 P1-6：把连续失败次数传给横幅
          retryIndex={autoTestRetryCount}
          retryTotal={3}
          onRetry={() => onAction('auto-test')}
          // v0.1.02 P3-AUDIT：自动倒计时路径不重置失败计数，让 P0-3 的 3 次上限生效
          onAutoRetry={() => onAction('auto-test-retry')}
          onCancel={clearInterruptBanner ?? (() => undefined)}
        />
      )}
      <p className="font-medium text-amber-800">📌 欢迎回来，{resumeGuide.projectName}</p>
      <p className="mt-0.5 text-amber-700/90">
        {resumeGuide.action === 'none' ? '目前进度：' : '项目进度：'}
        {resumeGuide.phaseText}
      </p>

      {/* 自动测试进行中：完整 5 步计划卡片（自带跑马灯 / 友好提示 / 计时），
          与 chat 视图主对话流体验保持一致 */}
      {autoTestRunning && autoTestPlan && (
        <div className="mt-2.5">
          <AutoTestPlanCard
            plan={autoTestPlan}
            currentStep={autoTestCurrentStep}
            startedAt={autoTestStartedAt}
            expectedDurationMs={autoTestExpectedDurationMs}
            latestProgress={autoTestLatestToolLabel ?? autoTestLatestProgress}
            dataTestid="fc-assistant-auto-test-plan"
            // v3.2.1 P2-12：overtime 状态允许用户手动中断
            onStop={onStopAutoTest}
          />
        </div>
      )}

      {/* 测试完成但还没收到结构化报告（极短窗口）：先呈现耗时摘要，避免用户只看到空白 */}
      {!autoTestRunning && autoTestLastSummary && !lastTestReport && (
        <div className="mt-2.5">
          <AutoTestSummaryCard
            summary={autoTestLastSummary}
            dataTestid="fc-assistant-auto-test-summary-pending"
          />
        </div>
      )}

      {!autoTestRunning && buttons ? (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {buttons.map((b) => (
            <button
              key={b.action}
              type="button"
              disabled={pending !== null}
              onClick={() => onAction(b.action)}
              className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending === b.action ? '处理中…' : b.label}
            </button>
          ))}
        </div>
      ) : (
        !autoTestRunning &&
        resumeGuide.action !== 'none' && (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => onAction(resumeGuide.action)}
            className="mt-2.5 w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending === resumeGuide.action ? '处理中…' : `${resumeGuide.actionText} →`}
          </button>
        )
      )}

      {autoTestRunning && (
        <p className="mt-1.5 text-[11px] text-amber-700/70">
          测试报告会自动写入聊天窗口，完成后浮窗可收起。
        </p>
      )}
    </div>
  );
}

function ElementTab({
  selectedElement,
  elementInfo,
  isProcessing,
  onSendModify,
  selectMode,
  onToggleSelect,
}: {
  selectedElement: ElementInfo | null;
  elementInfo: ElementSelectResult['elementInfo'] | null;
  isProcessing: boolean;
  onSendModify?: (instruction: string) => void;
  /** 元素选择模式：从 App 透传过来。元素 Tab 顶部开关的视觉态据此切换。 */
  selectMode: boolean;
  /** 切换回调：开关按钮触发。App 通过 setSelectMode 维护 selectMode 唯一真源。 */
  onToggleSelect: () => void;
}) {
  // 顶部开关：开始选择元素 ↔ 关闭选择元素。
  // 该开关取代了原来 PreviewToolbar 上的"🎯 选择元素 开/关"按钮（已删除），
  // 把"控制元素选择模式"和"展示元素信息"放在同一个上下文里，避免用户在
  // 左侧工具栏 / 右侧面板之间来回找。
  // 激活态用 brand 主色 + 强调文案，让用户一眼看到「现在是选元素模式」。
  const toggleButton = (
    <button
      type="button"
      onClick={onToggleSelect}
      data-testid="fc-assistant-select-mode-toggle"
      aria-pressed={selectMode}
      title={selectMode ? '当前为选择元素模式（点击元素查看信息）' : '当前为正常测试模式（可自由点击操作）'}
      className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
        selectMode
          ? 'border-brand bg-brand text-white hover:bg-brand-hover'
          : 'border-slate-300 bg-white text-slate-700 hover:border-brand hover:bg-brand/5 hover:text-brand'
      }`}
    >
      <span aria-hidden="true">🎯</span>
      <span>{selectMode ? '关闭选择元素' : '开始选择元素'}</span>
    </button>
  );

  if (!selectedElement || !elementInfo) {
    return (
      <div className="space-y-3">
        {toggleButton}
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
          🔍 元素信息
          <br />
          <span className="mt-1 block">
            {selectMode
              ? '在画布上点击任意组件查看信息'
              : '点上方按钮开启选择元素'}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {toggleButton}
      <ElementInspector
        element={selectedElement}
        info={elementInfo}
        isProcessing={isProcessing}
        onSendModify={(instruction) => onSendModify?.(instruction)}
      />
    </div>
  );
}

/* ========== 修复完成衔接：建议再测一次提示卡 ========== */

const SUGGEST_RETEST_WINDOW_MS = 30_000;

/**
 * 修复完成衔接提示卡的渲染条件（纯函数，便于单测覆盖所有分支）：
 * - 测试没在跑
 * - 有结构化测试报告
 * - verdict 不是 pass（pass 时引导用户去导出即可，无须再测）
 * - 最近 30 秒内触发过「一键修复」指令（lastTestFixAt 非 0）
 * - AI 没在处理中（避免 AI 还在改代码时就跳出来打断）
 */
export function shouldShowSuggestRetest(args: {
  autoTestRunning: boolean;
  lastTestReport: StructuredTestReport | null;
  lastTestFixAt: number | null;
  isProcessing: boolean;
  now?: number;
}): boolean {
  const now = args.now ?? Date.now();
  const fixAt = args.lastTestFixAt ?? 0;
  return (
    !args.autoTestRunning &&
    !!args.lastTestReport &&
    args.lastTestReport.verdict !== 'pass' &&
    fixAt > 0 &&
    now - fixAt < SUGGEST_RETEST_WINDOW_MS &&
    !args.isProcessing
  );
}

interface SuggestRetestCardProps {
  /** 最近一次「一键修复」指令发出的时间戳（ms）。组件内部据此渲染剩余倒计时 */
  lastTestFixAt: number;
  /** 点击「立即再测」触发 auto-test */
  onAction: (a: ResumeAction) => void;
  /** 关闭提示卡（用户点了「稍后」或 30s 倒计时到期），由父组件清掉 lastTestFixAt */
  onClear: () => void;
}

/**
 * 「代码已修复完毕，要不要再跑一次测试？」提示卡。
 * - 仅在父组件满足条件时渲染（本组件不做 verdict / 修复窗口检查，由 ProgressTab 决策）
 * - 1s 定时器：剩余倒计时刷新 + 30s 窗口过期时主动调 onClear
 * - useEffect 依赖 lastTestFixAt：用户连续触发新修复时重启 interval
 */
export function SuggestRetestCard({ lastTestFixAt, onAction, onClear }: SuggestRetestCardProps) {
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const elapsed = Date.now() - lastTestFixAt;
      if (elapsed >= SUGGEST_RETEST_WINDOW_MS) {
        onClearRef.current();
      } else {
        setTick((t) => t + 1);
      }
    }, 1_000);
    return () => window.clearInterval(id);
  }, [lastTestFixAt]);

  const remainingMs = Math.max(0, SUGGEST_RETEST_WINDOW_MS - (Date.now() - lastTestFixAt));
  return (
    <div
      data-testid="fc-assistant-suggest-retest"
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-slate-700 animate-fadeIn"
      role="status"
    >
      <p className="font-medium text-amber-800">✅ 代码已修复完毕</p>
      <p className="mt-0.5 text-amber-700/90">要不要再跑一次测试，确认问题已修复？</p>
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onAction('auto-test')}
          className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-600"
          data-testid="fc-assistant-suggest-retest-now"
        >
          🧪 立即再测
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-200"
          data-testid="fc-assistant-suggest-retest-later"
        >
          稍后
        </button>
        <span className="ml-auto tabular-nums text-[11px] text-amber-700/80">
          {formatDuration(remainingMs)} 后自动隐藏
        </span>
      </div>
    </div>
  );
}

/* ========== 测试完成态：差异化卡片（pass/warn/block） ========== */

interface TestReportCardProps {
  report: StructuredTestReport;
  resumeGuide: ResumeGuide | null;
  pending: ResumeAction | null;
  onAction: (a: ResumeAction) => void;
  onViewReport?: () => void;
  onOpenDeploy?: () => void;
  /** 「一键修复」指令发送：仅用于本卡片的修复按钮，与元素修改的 onSendModify 语义隔离 */
  onSendModifyFix?: (instruction: string) => void;
}

/**
 * 按 verdict 渲染完成态卡片：
 * - pass：绿 + 「去导出」主推 + 「再测一次」次推
 * - warn：黄 + 「帮我修」主推 + 「再测一次 / 直接导出」次推
 * - block：红 + 「一键修复」主推 + 「再测一次」次推 + 「导出」disabled
 *
 * 注意：单独 export 出来，便于单测直接断言 fadeIn / badgePop 类是否挂上。
 */
export function TestReportCard({
  report,
  resumeGuide,
  pending,
  onAction,
  onViewReport,
  onOpenDeploy,
  onSendModifyFix,
}: TestReportCardProps) {
  const v = report.verdict;
  const issues = [...(report.issues ?? [])].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
  const highCount = issues.filter((i) => i.severity === 'high').length;
  const mediumCount = issues.filter((i) => i.severity === 'medium').length;
  const lowCount = issues.filter((i) => i.severity === 'low').length;

  // 颜色调按 verdict 分（整体卡片背景 / 边框 / 标题 / 主按钮）
  const palette = paletteFor(v);

  // 主按钮文案 + 动作（只 push 到对话，不直接修改代码；AI 自己在对话里完成修复）
  const primaryLabel = (() => {
    if (v === 'pass') return onOpenDeploy ? '✅ 没问题，去部署 →' : '✅ 测试通过';
    if (v === 'warn') {
      const total = issues.length;
      return onSendModifyFix && total > 0
        ? `🔧 帮我修这些问题（${total}）`
        : '⚠️ 忽略问题，继续';
    }
    // block
    return onSendModifyFix && highCount > 0
      ? `🔧 一键修复（${highCount} 个阻塞）`
      : '⚠️ 暂时无法上线';
  })();
  const primaryAction: 'export' | 'fix' | 'retry' | 'ignore' = (() => {
    if (v === 'pass') return 'export';
    if (v === 'warn') return onSendModifyFix && issues.length > 0 ? 'fix' : 'ignore';
    return onSendModifyFix && highCount > 0 ? 'fix' : 'retry';
  })();

  const onPrimary = () => {
    if (primaryAction === 'export') {
      onOpenDeploy?.();
    } else if (primaryAction === 'fix') {
      onSendModifyFix?.(buildFixInstruction(report));
    } else if (primaryAction === 'ignore') {
      // warn 且没有修复入口：主按钮退化为「继续」语义，复用 auto-test 重新跑一遍
      onAction('auto-test');
    } else {
      onAction('auto-test');
    }
  };

  const exportDisabled = v === 'block';

  return (
    <div
      className={`rounded-xl border ${palette.card} motion-safe:animate-fadeIn motion-reduce:opacity-100 px-4 py-3 text-sm leading-relaxed text-slate-700`}
      data-testid="auto-test-report-card"
      data-verdict={v}
    >
      {/* 顶部：图标 + 完成 + verdict 徽章 */}
      <div className="flex items-center gap-2">
        <span className="text-base">{palette.icon}</span>
        <p className={`font-medium ${palette.title}`}>测试已完成</p>
        <span
          className={`ml-auto origin-right rounded-full px-2 py-0.5 text-[11px] font-medium motion-safe:animate-badgePop ${palette.badge}`}
          data-testid="auto-test-verdict-badge"
        >
          {report.verdictLabel ?? defaultVerdictLabel(v)}
        </span>
      </div>

      {/* 摘要 */}
      {report.summary && (
        <p
          className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-white/60 px-2.5 py-1.5 text-xs text-slate-600"
          data-testid="auto-test-summary"
        >
          {report.summary}
        </p>
      )}

      {/* 问题清单 */}
      {issues.length > 0 && (
        <div className="mt-3" data-testid="auto-test-issues">
          <p className="mb-1.5 text-xs font-medium text-slate-500">
            ⚠️ 发现 {issues.length} 个问题
            {highCount > 0 ? `（高 ${highCount}）` : ''}
            {mediumCount > 0 ? `（中 ${mediumCount}）` : ''}
            {lowCount > 0 ? `（低 ${lowCount}）` : ''}
          </p>
          <ul className="space-y-1.5">
            {issues.map((issue, idx) => (
              <IssueRow
                key={`${issue.severity}-${idx}`}
                issue={issue}
                onFix={
                  onSendModifyFix ? () => onSendModifyFix(buildSingleFixInstruction(issue)) : undefined
                }
              />
            ))}
          </ul>
        </div>
      )}

      {/* 主按钮 */}
      <button
        type="button"
        disabled={pending !== null}
        onClick={onPrimary}
        className={`mt-3 w-full rounded-lg py-2 text-sm font-medium text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${palette.primaryBtn}`}
        data-testid="auto-test-primary"
      >
        {primaryLabel}
      </button>

      {/* 次按钮：再测一次 + 导出 */}
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => onAction('auto-test')}
          className="flex-1 rounded-lg bg-slate-200 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="auto-test-retry"
        >
          🧪 再测一次
        </button>
        {onOpenDeploy && (
          <button
            type="button"
            disabled={exportDisabled || pending !== null}
            onClick={() => onOpenDeploy()}
            title={
              exportDisabled
                ? `还有 ${highCount} 个高严重度问题，先修复再部署`
                : '打开部署面板'
            }
            className="flex-1 rounded-lg bg-slate-200 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="auto-test-deploy"
          >
            📦 去部署
          </button>
        )}
      </div>

      {/* 完整报告入口 */}
      {onViewReport && (
        <button
          type="button"
          onClick={onViewReport}
          className="mt-1.5 w-full rounded-md py-1 text-[11px] text-slate-500 transition-colors hover:text-slate-700"
        >
          📄 查看完整测试报告 →
        </button>
      )}

      {resumeGuide && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          {resumeGuide.projectName} · {resumeGuide.phaseText}
        </p>
      )}
    </div>
  );
}

/** 单条问题行：高/中/低 严重度色点 + 标题 + 详情 + 可选修复按钮 */
function IssueRow({ issue, onFix }: { issue: TestIssue; onFix?: () => void }) {
  const dot =
    issue.severity === 'high'
      ? 'bg-rose-500'
      : issue.severity === 'medium'
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  const label =
    issue.severity === 'high' ? '高' : issue.severity === 'medium' ? '中' : '低';
  return (
    <li className="flex items-start gap-2 rounded-md border border-slate-200 bg-white/70 px-2.5 py-1.5 text-xs">
      <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-700">
          <span className="mr-1 text-[10px] text-slate-400">{label}</span>
          {issue.title}
          {issue.file && (
            <span className="ml-1 font-mono text-[10px] text-slate-400">
              ({issue.file})
            </span>
          )}
        </p>
        {issue.detail && (
          <p className="mt-0.5 text-[11px] text-slate-500">{issue.detail}</p>
        )}
      </div>
      {onFix && (
        <button
          type="button"
          onClick={onFix}
          className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 transition-colors hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700"
        >
          修复
        </button>
      )}
    </li>
  );
}

/** 严重度排序权重：high=0, medium=1, low=2（列表展示按高→低） */
function severityRank(s: TestIssue['severity']): number {
  return s === 'high' ? 0 : s === 'medium' ? 1 : 2;
}

/** 默认 verdict 标签（AI 没给 verdictLabel 时使用） */
function defaultVerdictLabel(v: TestVerdict): string {
  if (v === 'pass') return '可上线';
  if (v === 'warn') return '有非阻塞问题';
  return '有阻塞问题';
}

/** verdict 调色板：卡片 / 标题 / 主按钮 / 徽章 / 图标 */
function paletteFor(v: TestVerdict): {
  card: string;
  title: string;
  primaryBtn: string;
  badge: string;
  icon: string;
} {
  if (v === 'pass') {
    return {
      card: 'border-emerald-300 bg-emerald-50',
      title: 'text-emerald-800',
      primaryBtn: 'bg-emerald-600 hover:bg-emerald-700',
      badge: 'bg-emerald-100 text-emerald-700',
      icon: '✅',
    };
  }
  if (v === 'warn') {
    return {
      card: 'border-amber-300 bg-amber-50',
      title: 'text-amber-800',
      primaryBtn: 'bg-amber-500 hover:bg-amber-600',
      badge: 'bg-amber-100 text-amber-700',
      icon: '⚠️',
    };
  }
  // block
  return {
    card: 'border-rose-300 bg-rose-50',
    title: 'text-rose-800',
    primaryBtn: 'bg-rose-600 hover:bg-rose-700',
    badge: 'bg-rose-100 text-rose-700',
    icon: '❌',
  };
}

/** 「一键修复全部」拼接成的中文指令（发到对话流，复用 buildModifyTask） */
function buildFixInstruction(report: StructuredTestReport): string {
  const lines: string[] = ['请修复下面这些问题：'];
  for (const it of report.issues) {
    const filePart = it.file ? `（位于 ${it.file}）` : '';
    const severityZh = it.severity === 'high' ? '高' : it.severity === 'medium' ? '中' : '低';
    lines.push(`- [${severityZh}] ${it.title}${filePart}`);
    if (it.detail) lines.push(`  说明：${it.detail}`);
  }
  lines.push('');
  lines.push('修完后告诉我改了什么，我会重新跑一次测试。');
  return lines.join('\n');
}

/** 「修复单条」拼接成的中文指令 */
function buildSingleFixInstruction(issue: TestIssue): string {
  const severityZh = issue.severity === 'high' ? '高' : issue.severity === 'medium' ? '中' : '低';
  const filePart = issue.file ? `（位于 ${issue.file}）` : '';
  const detailPart = issue.detail ? `\n说明：${issue.detail}` : '';
  return `请修复以下[${severityZh}]严重度的问题${filePart}：\n${issue.title}${detailPart}`;
}
