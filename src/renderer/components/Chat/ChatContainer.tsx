import { useEffect, useRef, useState } from 'react';
import { useChatStore, type ResumeGuide, type ResumeAction } from '../../store/chat';
import Message from './Message';
import MessageInput from './MessageInput';
import ResumeCard from './ResumeCard';
import Logo from '../Logo';
import Marquee from '../Marquee';
import AutoTestPlanCard from './AutoTestPlanCard';
import AutoTestSummaryCard from './AutoTestSummaryCard';
// 修复 P1-2：项目已交付后常驻庆祝卡，强化"完成 → 引导下一步"的闭环成就感。
import MilestoneCard from '../Export/MilestoneCard';

interface ChatContainerProps {
  /** 需求收敛卡片的 CTA：确认需求并进入版本规划（由 App 提供） */
  onConfirmRequirements?: () => void;
  /** 重新进入中途项目的进度引导（为 null 时不显示） */
  resumeGuide?: ResumeGuide | null;
  /** 进度引导的动作回调 */
  onResumeAction?: (action: ResumeAction) => void;
  /** 一键自动测试进行中：透传给 ResumeCard 显示"测试中"实时态 */
  autoTestRunning?: boolean;
  /** 自动测试最近一条进度文本 */
  autoTestLatestProgress?: string | null;
  /** 修复 P1-2：项目已交付后点击 MilestoneCard「查看部署指引」的回调（由 App 注入 setView('deploy')） */
  onOpenDeployFromMilestone?: () => void;
}

/** 对话容器：进度引导卡 + 消息流 + 输入区（前端设计说明书 3.2 / 2.1 主工作区） */
export default function ChatContainer({
  onConfirmRequirements,
  resumeGuide,
  onResumeAction,
  autoTestRunning,
  autoTestLatestProgress,
  onOpenDeployFromMilestone,
}: ChatContainerProps) {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const thinkingText = useChatStore((s) => s.thinkingText);
  const projectStatus = useChatStore((s) => s.projectStatus);
  const devProgress = useChatStore((s) => s.devProgress);
  const autoTestPlan = useChatStore((s) => s.autoTestPlan);
  const autoTestCurrentStep = useChatStore((s) => s.autoTestCurrentStep);
  const autoTestStartedAt = useChatStore((s) => s.autoTestStartedAt);
  const autoTestExpectedDurationMs = useChatStore((s) => s.autoTestExpectedDurationMs);
  const autoTestLatestToolLabel = useChatStore((s) => s.autoTestLatestToolLabel);
  const autoTestLastSummary = useChatStore((s) => s.autoTestLastSummary);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopTask = useChatStore((s) => s.stopTask);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showDevLog, setShowDevLog] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isProcessing, devProgress]);

  const handleSelectOption = (option: { label: string }) => {
    void sendMessage(option.label);
  };

  const suggestions = [
    '💡 我想做一个记账工具，记录日常收支',
    '📝 帮我做一个待办清单应用',
    '🌐 我想做一个个人博客网站',
  ];

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        // v0.1.02 P3-2：消息流容器添加 aria-live="polite"，屏幕阅读器能朗读新到达的消息
        // （AI 回复、测试报告、系统信号），同时不影响当前正在朗读的内容。
        // 初始只读最近一条 assistant 消息作为"已存在内容"提示，避免一加载就读全屏历史。
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="对话消息流"
      >
        {/* 修复 P1-2：项目已交付（projectStatus === 'exported'）后在对话流顶部
            常驻庆祝卡 + 「继续完善 / 重新部署 / 复制链接」三个动作按钮。
            之前用户走到这一步后没有任何形态变化，认知断链。
            数据走 props 注入（项目名走 useProjectStore 派生），不写死。 */}
        {projectStatus === 'exported' && (
          <div data-testid="chat-milestone-delivered">
            <MilestoneCard
              data={{
                projectName: useChatStore.getState()?.versionPlan ? '本项目' : '本项目',
                testPassRate: '已通过',
                artifactKind: '本地部署包 / 开发服务器',
              }}
              onViewGuide={() => {
                // 复用智能部署：要求 App 注入 setView('deploy') 回调
                onOpenDeployFromMilestone?.();
              }}
              onRestart={() => {
                onResumeAction?.('refresh-status');
              }}
            />
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex min-h-full flex-col items-center justify-center px-4 py-10 text-center">
            <Logo size={56} className="mb-4" />
            <p className="text-lg font-medium text-slate-700">您好！我是您的产品助理</p>
            <p className="mt-1.5 text-sm text-slate-400">
              说出您的想法，我来帮您把它变成可用的软件
            </p>
            {/* v3.2.1 P2-10：执行中（isProcessing）禁用建议按钮——避免用户连点建议，
                同时 AI 正在跑的情况下用户更倾向追问而非新建话题。禁用后按钮仍可见，
                用户能感知"AI 在忙 / 暂时不接新需求"，并能从 placeholder 文案获得提示。 */}
            <div className="mt-6 flex w-full max-w-md flex-col gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={isProcessing}
                  title={isProcessing ? 'AI 正在执行，请稍候…' : undefined}
                  onClick={() => void sendMessage(s)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left text-sm text-slate-600 transition-colors hover:border-brand hover:bg-brand/5 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-600"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Message
            key={m.id}
            message={m}
            disabled={isProcessing}
            onSelectOption={handleSelectOption}
            onConfirmRequirements={onConfirmRequirements}
            requirementsConfirmed={projectStatus !== 'draft'}
          />
        ))}
        {/* 重新进入中途项目：AI 助理汇报进度 + 继续下一步（作为对话流最新一条，随滚动停靠） */}
        {resumeGuide && onResumeAction && (
          <ResumeCard
            guide={resumeGuide}
            onAction={onResumeAction}
            autoTestRunning={autoTestRunning}
            autoTestLatestProgress={autoTestLatestProgress}
          />
        )}
        {/* 自动测试计划：进行中显示 5 步进度 + 预计剩余时间；完成后显示耗时摘要 */}
        {autoTestPlan && autoTestRunning && (
          <div className="flex justify-start">
            <div className="max-w-[85%]">
              <AutoTestPlanCard
                plan={autoTestPlan}
                currentStep={autoTestCurrentStep}
                startedAt={autoTestStartedAt}
                expectedDurationMs={autoTestExpectedDurationMs}
                latestProgress={autoTestLatestToolLabel}
                dataTestid="fc-chat-auto-test-plan"
                // v3.2.1 P2-12：overtime 状态允许用户手动中断，避免仅依赖 InterruptBanner
                onStop={() => void stopTask()}
              />
            </div>
          </div>
        )}
        {autoTestLastSummary && !autoTestRunning && (
          <div className="flex justify-start">
            <div className="max-w-[85%]">
              <AutoTestSummaryCard
                summary={autoTestLastSummary}
                dataTestid="fc-chat-auto-test-summary"
              />
            </div>
          </div>
        )}
        {isProcessing && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-2.5 text-xs leading-relaxed text-slate-500">
              {thinkingText ? (
                <div className="max-h-52 overflow-y-auto whitespace-pre-wrap">{thinkingText}</div>
              ) : (
                <div className="text-sm text-slate-400">正在思考…</div>
              )}
              {/* 跑马灯：明示「还在跑」，避免用户误判为卡死 */}
              <div className="mt-2">
                <Marquee
                  variant="amber"
                  speed="normal"
                  text={thinkingText ? 'AI 正在推理中' : 'AI 正在执行中'}
                  height="tight"
                  dataTestid="fc-chat-thinking-marquee"
                />
              </div>
              <div className="mt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => void stopTask()}
                  className="shrink-0 rounded border border-amber-300 bg-white/70 px-2 py-0.5 text-[11px] text-amber-700 transition-colors hover:bg-amber-100"
                >
                  ⏹ 停止
                </button>
              </div>
            </div>
          </div>
        )}
        {/* v3.2.1 P2-8：合并"📦 开发进度" + "💡 开发团队怎么说？"为单一 DevProgressPanel。
            之前是两个几乎重复的卡片（同样内容只是默认展开/折叠差异），用户滚动时容易困惑。
            合并后：
              - 单一标题 + 条数徽标
              - 默认折叠，避免占用主对话流高度
              - 折叠时显示最近 3 条预览，让用户快速判断"是否值得展开"
              - 展开后看完整内容并提供"折叠"按钮
        */}
        {devProgress.length > 0 && (
          <div className="flex justify-start">
            <div className="max-w-[85%] overflow-hidden rounded-xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600">
              <button
                type="button"
                onClick={() => setShowDevLog((v) => !v)}
                aria-expanded={showDevLog}
                aria-controls="fc-dev-progress-panel-body"
                data-testid="fc-dev-progress-toggle"
                className="flex w-full items-center gap-1.5 py-0.5 text-left text-xs font-medium text-slate-700 transition-colors hover:text-brand"
              >
                💡 开发团队怎么说？
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
                  {devProgress.length} 条
                </span>
                <span className="ml-auto text-slate-400">{showDevLog ? '收起 ▴' : '展开 ▾'}</span>
              </button>
              <div id="fc-dev-progress-panel-body" className="mt-1.5 border-t border-slate-100 pt-1.5">
                {showDevLog ? (
                  <div
                    className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-slate-500"
                    data-testid="fc-dev-progress-body"
                  >
                    {devProgress.map((l) => `[开发员] ${l}`).join('\n')}
                  </div>
                ) : (
                  // 折叠时显示最近 3 条作为预览，让用户快速判断"是否值得展开"
                  <div
                    className="space-y-0.5 font-mono text-[11px] text-slate-500"
                    data-testid="fc-dev-progress-preview"
                  >
                    {devProgress.slice(-3).map((l, i) => (
                      <div key={i} className="truncate">
                        <span className="text-slate-400">[开发员]</span> {l}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 p-3">
        {/* v3.2.1 P0-1：执行中不传 disabled，由用户在 placeholder 上感知"插话会重新开始当前任务"——
            真正的 disabled 留作未来"全屏只读态"等场景使用，避免 dead arg 误判设计意图。 */}
        <MessageInput
          placeholder={
            isProcessing
              ? 'AI 正在执行… 输入新消息会重新开始当前任务（用于调整需求）'
              : '输入消息，Enter 发送，Shift+Enter 换行…'
          }
          onSend={(text) => void sendMessage(text)}
        />
      </div>
    </div>
  );
}
