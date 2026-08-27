import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ResumeGuide, ResumeAction } from '../../store/chat';
import type { ElementInfo, ElementSelectResult } from '@shared/types/preview';
import ElementInspector from './ElementInspector';
import DevLog from '../DevLog';
import MiniChat from '../Chat/MiniChat';

interface AssistantPanelProps {
  /** 项目进度引导（项目恢复 / 继续下一步 / 自动测试进度等） */
  resumeGuide?: ResumeGuide | null;
  onResumeAction: (action: ResumeAction) => void;
  /** 一键自动测试进行中（浮窗自动展开并切到「进度」Tab） */
  autoTestRunning?: boolean;
  /** 自动测试最近一条进度文本 */
  autoTestLatestProgress?: string | null;
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
  /** 最近一次自动测试的完成摘要（测试完成时展示 ✅ 完成态） */
  lastTestSummary?: string | null;
  /** 查看完整测试报告（切到 chat 视图看报告消息） */
  onViewReport?: () => void;
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
  selectedElement = null,
  elementInfo = null,
  isProcessing = false,
  onSendModify,
  devProgress = [],
  lastTestSummary = null,
  onViewReport,
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
            lastTestSummary={lastTestSummary}
            pending={pending}
            onAction={act}
            onViewReport={onViewReport}
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
          <MiniChat placeholder="和 AI 聊聊，比如：标题颜色太深 / 继续开发 / 登录那块逻辑有问题…" />
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
  lastTestSummary,
  pending,
  onAction,
  onViewReport,
}: {
  resumeGuide: ResumeGuide | null;
  autoTestRunning: boolean;
  autoTestLatestProgress: string | null;
  lastTestSummary: string | null;
  pending: ResumeAction | null;
  onAction: (a: ResumeAction) => void;
  onViewReport?: () => void;
}) {
  // 测试完成态：autoTestRunning=false 且存在完成摘要时优先展示 ✅ 完成
  if (!autoTestRunning && lastTestSummary) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-base">✅</span>
          <p className="font-medium text-emerald-800">测试已完成</p>
        </div>
        <p
          className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-emerald-200 bg-white/60 px-2.5 py-1.5 text-xs text-slate-600"
          data-testid="auto-test-summary"
        >
          {lastTestSummary}
        </p>
        <div className="mt-2.5 flex gap-2">
          {onViewReport && (
            <button
              type="button"
              onClick={onViewReport}
              className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              📄 查看完整测试报告 →
            </button>
          )}
          {resumeGuide && resumeGuide.action !== 'none' && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => onAction(resumeGuide.action)}
              className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending === resumeGuide.action ? '处理中…' : `${resumeGuide.actionText} →`}
            </button>
          )}
        </div>
        {resumeGuide && (
          <p className="mt-1.5 text-[11px] text-slate-500">
            {resumeGuide.projectName} · {resumeGuide.phaseText}
          </p>
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

      {autoTestRunning && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-amber-300 bg-white/70 px-3 py-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
          <span className="text-sm font-medium text-amber-800">🧪 测试进行中</span>
        </div>
      )}

      {autoTestRunning && autoTestLatestProgress && (
        <p
          className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-amber-200 bg-white/60 px-2.5 py-1.5 text-xs text-slate-600"
          data-testid="auto-test-progress"
        >
          {autoTestLatestProgress}
        </p>
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
