import { useEffect } from 'react';
import { useChatStore, DEFAULT_AUTO_TEST_PLAN } from '../store/chat';
import type { StructuredTestReport } from '@shared/types/project';
import { inferAutoTestStep } from '../components/Chat/autoTestProgress';

/** 订阅主进程事件：AI 响应流（chat:response）与信号推送（chat:signal） */
export function useChatEvents(): void {
  const setProcessing = useChatStore((s) => s.setProcessing);
  const setThinkingText = useChatStore((s) => s.setThinkingText);
  const setDevTaskRunning = useChatStore((s) => s.setDevTaskRunning);
  const setAutoTestRunning = useChatStore((s) => s.setAutoTestRunning);
  const setAutoTestLatestProgress = useChatStore((s) => s.setAutoTestLatestProgress);
  const setLastTestReport = useChatStore((s) => s.setLastTestReport);
  const appendDevProgress = useChatStore((s) => s.appendDevProgress);
  const clearDevProgress = useChatStore((s) => s.clearDevProgress);
  const pushMessage = useChatStore((s) => s.pushMessage);
  const setRequirements = useChatStore((s) => s.setRequirements);
  const setAutoTestPlan = useChatStore((s) => s.setAutoTestPlan);
  const setAutoTestCurrentStep = useChatStore((s) => s.setAutoTestCurrentStep);
  const setAutoTestStartedAt = useChatStore((s) => s.setAutoTestStartedAt);
  const setAutoTestExpectedDurationMs = useChatStore((s) => s.setAutoTestExpectedDurationMs);
  const setAutoTestToolCount = useChatStore((s) => s.setAutoTestToolCount);
  const setAutoTestLatestToolLabel = useChatStore((s) => s.setAutoTestLatestToolLabel);
  const setAutoTestLastSummary = useChatStore((s) => s.setAutoTestLastSummary);
  const setInterruptBanner = useChatStore((s) => s.setInterruptBanner);
  const resetAutoTestPlan = useChatStore((s) => s.resetAutoTestPlan);

  useEffect(() => {
    const unsubResponse = window.electron.chat.onResponse((data) => {
      // 自动测试流程的事件：仅用于驱动右侧"测试中"反馈，不影响主对话流
      if (data.source === 'auto-test') {
        if (data.type === 'thinking') {
          // 初始化计划：依据上次耗时学习 estimated duration（与当前任务模型接近时复用）
          const last = useChatStore.getState().autoTestLastSummary;
          const expected =
            last && last.totalDurationMs > 0 ? last.totalDurationMs : 25_000;
          setAutoTestPlan(DEFAULT_AUTO_TEST_PLAN);
          setAutoTestCurrentStep(0);
          setAutoTestStartedAt(Date.now());
          setAutoTestExpectedDurationMs(expected);
          setAutoTestToolCount(0);
          setAutoTestLatestToolLabel(null);
          setAutoTestRunning(true);
          setAutoTestLatestProgress(data.content ?? null);
        } else if (data.type === 'progress') {
          if (data.content) {
            setAutoTestRunning(true);
            setAutoTestLatestProgress(data.content);
            // 同步写入开发日志区域，让"看看开发怎么说"Tab 也能看到工具调用过程
            appendDevProgress(data.content);
            // 推进测试计划进度
            const next = useChatStore.getState().autoTestToolCount + 1;
            const hasBash = data.content.includes('🛠');
            setAutoTestToolCount(next);
            setAutoTestLatestToolLabel(data.content);
            setAutoTestCurrentStep(inferAutoTestStep(next, hasBash));
          }
        } else if (data.type === 'message') {
          // 测试报告到达：保留最近进度作为完成态文案，等用户切回看
          setAutoTestRunning(false);
          if (data.content) {
            // 主进程解析后附带 autoTestReport；缺失时降级为 warn（fullReport=原文）
            const report: StructuredTestReport =
              data.autoTestReport ?? {
                verdict: 'warn',
                issues: [],
                fullReport: data.content,
              };
            setLastTestReport(report);
            pushMessage({
              role: 'assistant',
              content: data.content,
              reasoning: data.reasoning,
              timestamp: data.timestamp,
            });
            // 生成测试计划耗时摘要 → 持久化到聊天历史
            const state = useChatStore.getState();
            const plan = state.autoTestPlan ?? DEFAULT_AUTO_TEST_PLAN;
            const finishedAt = new Date();
            const totalDurationMs = state.autoTestStartedAt
              ? Math.max(0, finishedAt.getTime() - state.autoTestStartedAt)
              : 0;
            // 各步骤平均分摊总时长（不记录每步精确边界，避免与启发式推断错位）
            const perStep = Math.max(0, Math.round(totalDurationMs / plan.length));
            const stepDurationsMs = plan.map(() => perStep);
            const summary = {
              steps: plan,
              stepDurationsMs,
              totalDurationMs,
              finishedAt: finishedAt.toISOString(),
            };
            setAutoTestLastSummary(summary);
            // 在对话流追加摘要系统消息（按用户期望的"完成后写入聊天历史"）
            pushMessage({
              role: 'system',
              content: `🧪 测试计划已完成：${plan
                .map((s) => s.title)
                .join(' → ')}，总耗时 ${Math.round(totalDurationMs / 1000)} 秒`,
              timestamp: finishedAt.toISOString(),
            });
          }
          // 测试完成：resetAutoTestPlan() 已同步清掉 autoTestLatestProgress，不需 setTimeout 兜底
          // （保留上次进度可在后续历史中重新出现，但清掉能避免“最近提示”长期残留）
          // 重置进行中的计划字段（保留 lastSummary / lastTestReport）
          resetAutoTestPlan();
        }
        return;
      }

      if (data.type === 'thinking') {
        setProcessing(true);
        setThinkingText(data.content ?? null);
      } else if (data.type === 'progress') {
        // 开发进度报告（工具调用流）
        if (data.content) appendDevProgress(data.content);
      } else if (data.type === 'message') {
        pushMessage({
          role: 'assistant',
          content: data.content ?? '',
          reasoning: data.reasoning,
          timestamp: data.timestamp,
        });
        if (data.requirements) {
          setRequirements(data.requirements);
        }
        setProcessing(false);
        setThinkingText(null);
      } else if (data.type === 'done') {
        setProcessing(false);
        setThinkingText(null);
      }
    });

    const unsubSignal = window.electron.chat.onSignal((signal) => {
      pushMessage({
        role: 'system',
        content: signal.message,
        timestamp: signal.timestamp,
      });
      // 开发任务失败信号：复位"开发中"状态并清空进度，引导卡回到"是否继续"，允许重试
      if (signal.type === 'error') {
        const state = useChatStore.getState();
        // 自动测试进行中被中断：弹 amber banner 给用户提供 5s 自动重试入口
        // （区别于开发任务失败 → 走 reset 路径让用户从 ResumeGuide 重新触发）
        // 注意：reset 路径会把 interruptBanner 也清掉，所以 banner 必须在 reset 之后设置
        setDevTaskRunning(false);
        setAutoTestRunning(false);
        setAutoTestLatestProgress(null);
        clearDevProgress();
        resetAutoTestPlan();
        if (state.autoTestRunning) {
          setInterruptBanner({
            reason: signal.message,
            retryAt: Date.now() + 5_000,
          });
        }
      }
    });

    return () => {
      unsubResponse();
      unsubSignal();
    };
  }, [
    setProcessing,
    setThinkingText,
    setDevTaskRunning,
    setAutoTestRunning,
    setAutoTestLatestProgress,
    setLastTestReport,
    appendDevProgress,
    clearDevProgress,
    pushMessage,
    setRequirements,
    setAutoTestPlan,
    setAutoTestCurrentStep,
    setAutoTestStartedAt,
    setAutoTestExpectedDurationMs,
    setAutoTestToolCount,
    setAutoTestLatestToolLabel,
    setAutoTestLastSummary,
    setInterruptBanner,
    resetAutoTestPlan,
  ]);
}
