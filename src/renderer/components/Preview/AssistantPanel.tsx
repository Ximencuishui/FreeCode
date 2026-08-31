import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ResumeGuide, ResumeAction } from '../../store/chat';
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
import MiniChat from '../Chat/MiniChat';
import AutoTestPlanCard from '../Chat/AutoTestPlanCard';
import AutoTestSummaryCard from '../Chat/AutoTestSummaryCard';

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
  /** 开发日志（DSH 工具调用与结果流） */
  devProgress?: string[];
  /** 最近一次自动测试的结构化报告（用于完成态分流 + 问题清单） */
  lastTestReport?: StructuredTestReport | null;
  /** 查看完整测试报告（切到 chat 视图看报告消息） */
  onViewReport?: () => void;
  /** 打开导出面板（用于完成态卡片的「去导出」按钮） */
  onOpenExport?: () => void;
  /** 外部覆盖样式：用于把父容器的可拖动宽度（width）应用到根 aside */
  style?: CSSProperties;
  /** 外部追加 className：一般不需要，但预留口子方便父级布局定制 */
  className?: string;
}

type TabKey = 'progress' | 'element' | 'devlog';

/**
 * AI 助理右侧面板（preview 视图）：
 * - 与 chat 视图的右侧面板结构对齐：标题 + 3-Tab + Tab 内容 + 底部 MiniChat（常驻输入框）
 * - 3-Tab：📌 进度 / 🔍 元素 / 💬 开发日志
 * - 选中元素 → 切到 🔍 Tab；测试进行中 / 测试刚结束 → 切到 📌 Tab；其他情况停留在用户最后选择
 * - 底部 MiniChat 始终显示（用于「看到问题 → 直接反馈」）；当用户进入 🔍 元素 Tab
 *   且已选中元素时，ElementInspector 内部已自带修改指令 MiniChat，避免重复输入框，
 *   此时隐藏面板底部 MiniChat，让用户专注在元素修改上下文里
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
  devProgress = [],
  lastTestReport = null,
  onViewReport,
  onOpenExport,
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
  };

  const tabClass = (t: TabKey) =>
    `flex-1 rounded-md py-1.5 transition-colors ${
      tab === t
        ? 'bg-white text-slate-800 shadow-sm'
        : 'text-slate-500 hover:text-slate-700'
    }`;

  // 进入 🔍 元素 Tab 且已选中元素时，ElementInspector 内部已自带修改指令 MiniChat，
  // 此时隐藏面板底部 MiniChat，避免两个输入框同时出现造成认知负担。
  const hideBottomChat = tab === 'element' && hasElement;

  return (
    <aside
      className={`flex h-full shrink-0 flex-col bg-slate-50 text-sm leading-relaxed text-slate-700 ${className}`.trim()}
      style={style}
    >
      {/* 标题 */}
      <div className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex items-center px-4 pt-3 pb-2">
          <h3 className="text-sm font-semibold text-slate-800">🤖 AI 助理</h3>
        </div>
        <div className="flex gap-0.5 px-3 pb-2">
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
            onOpenExport={onOpenExport}
            onSendModify={onSendModify}
          />
        )}
        {tab === 'element' && (
          <ElementTab
            selectedElement={selectedElement}
            elementInfo={elementInfo}
            isProcessing={isProcessing}
            onSendModify={onSendModify}
          />
        )}
        {tab === 'devlog' && <DevLog lines={devProgress} />}
      </div>

      {/* 底部 MiniChat：常驻输入框，让用户随时反馈；
          选中元素进入 🔍 Tab 时由 ElementInspector 接管，避免重复 */}
      {!hideBottomChat && (
        <div className="shrink-0 border-t border-slate-200 bg-slate-100/70 p-3">
          <MiniChat
            placeholder="和 AI 聊聊，比如：标题颜色太深 / 继续开发 / 登录那块逻辑有问题…"
            marqueeOnProcessing
            marqueeText={autoTestRunning ? '🧪 测试中…' : 'AI 正在处理中'}
          />
        </div>
      )}
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
  onOpenExport,
  onSendModify,
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
  onOpenExport?: () => void;
  onSendModify?: (instruction: string) => void;
}) {
  // 测试完成态：autoTestRunning=false 且存在结构化报告时优先展示 ✅/⚠️/❌ 完成态
  if (!autoTestRunning && lastTestReport) {
    return (
      <div className="space-y-3">
        <TestReportCard
          report={lastTestReport}
          resumeGuide={resumeGuide}
          pending={pending}
          onAction={onAction}
          onViewReport={onViewReport}
          onOpenExport={onOpenExport}
          onSendModify={onSendModify}
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
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
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
}: {
  selectedElement: ElementInfo | null;
  elementInfo: ElementSelectResult['elementInfo'] | null;
  isProcessing: boolean;
  onSendModify?: (instruction: string) => void;
}) {
  if (!selectedElement || !elementInfo) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
        🔍 元素信息
        <br />
        <span className="mt-1 block">在预览中点击任意元素（先开启 🎯 选择元素）</span>
      </div>
    );
  }
  return (
    <ElementInspector
      element={selectedElement}
      info={elementInfo}
      isProcessing={isProcessing}
      onSendModify={(instruction) => onSendModify?.(instruction)}
    />
  );
}

/* ========== 测试完成态：差异化卡片（pass/warn/block） ========== */

interface TestReportCardProps {
  report: StructuredTestReport;
  resumeGuide: ResumeGuide | null;
  pending: ResumeAction | null;
  onAction: (a: ResumeAction) => void;
  onViewReport?: () => void;
  onOpenExport?: () => void;
  onSendModify?: (instruction: string) => void;
}

/**
 * 按 verdict 渲染完成态卡片：
 * - pass：绿 + 「去导出」主推 + 「再测一次」次推
 * - warn：黄 + 「帮我修」主推 + 「再测一次 / 直接导出」次推
 * - block：红 + 「一键修复」主推 + 「再测一次」次推 + 「导出」disabled
 */
function TestReportCard({
  report,
  resumeGuide,
  pending,
  onAction,
  onViewReport,
  onOpenExport,
  onSendModify,
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
    if (v === 'pass') return onOpenExport ? '✅ 没问题，去导出 →' : '✅ 测试通过';
    if (v === 'warn') {
      const total = issues.length;
      return onSendModify && total > 0
        ? `🔧 帮我修这些问题（${total}）`
        : '⚠️ 忽略问题，继续';
    }
    // block
    return onSendModify && highCount > 0
      ? `🔧 一键修复（${highCount} 个阻塞）`
      : '⚠️ 暂时无法上线';
  })();
  const primaryAction: 'export' | 'fix' | 'retry' | 'ignore' = (() => {
    if (v === 'pass') return 'export';
    if (v === 'warn') return onSendModify && issues.length > 0 ? 'fix' : 'ignore';
    return onSendModify && highCount > 0 ? 'fix' : 'retry';
  })();

  const onPrimary = () => {
    if (primaryAction === 'export') {
      onOpenExport?.();
    } else if (primaryAction === 'fix') {
      onSendModify?.(buildFixInstruction(report));
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
      className={`rounded-xl border ${palette.card} px-4 py-3 text-sm leading-relaxed text-slate-700`}
      data-testid="auto-test-report-card"
      data-verdict={v}
    >
      {/* 顶部：图标 + 完成 + verdict 徽章 */}
      <div className="flex items-center gap-2">
        <span className="text-base">{palette.icon}</span>
        <p className={`font-medium ${palette.title}`}>测试已完成</p>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${palette.badge}`}
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
                  onSendModify ? () => onSendModify(buildSingleFixInstruction(issue)) : undefined
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
        {onOpenExport && (
          <button
            type="button"
            disabled={exportDisabled || pending !== null}
            onClick={() => onOpenExport()}
            title={
              exportDisabled
                ? `还有 ${highCount} 个高严重度问题，先修复再导出`
                : '打开导出面板'
            }
            className="flex-1 rounded-lg bg-slate-200 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="auto-test-export"
          >
            📦 去导出
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
