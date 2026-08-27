import { useEffect } from 'react';
import { useChatStore } from '../store/chat';

/** 订阅主进程事件：AI 响应流（chat:response）与信号推送（chat:signal） */
export function useChatEvents(): void {
  const setProcessing = useChatStore((s) => s.setProcessing);
  const setThinkingText = useChatStore((s) => s.setThinkingText);
  const setDevTaskRunning = useChatStore((s) => s.setDevTaskRunning);
  const setAutoTestRunning = useChatStore((s) => s.setAutoTestRunning);
  const setAutoTestLatestProgress = useChatStore((s) => s.setAutoTestLatestProgress);
  const setLastTestSummary = useChatStore((s) => s.setLastTestSummary);
  const appendDevProgress = useChatStore((s) => s.appendDevProgress);
  const clearDevProgress = useChatStore((s) => s.clearDevProgress);
  const pushMessage = useChatStore((s) => s.pushMessage);
  const setRequirements = useChatStore((s) => s.setRequirements);

  useEffect(() => {
    const unsubResponse = window.electron.chat.onResponse((data) => {
      // 自动测试流程的事件：仅用于驱动右侧"测试中"反馈，不影响主对话流
      if (data.source === 'auto-test') {
        if (data.type === 'thinking') {
          setAutoTestRunning(true);
          setAutoTestLatestProgress(data.content ?? null);
        } else if (data.type === 'progress') {
          if (data.content) {
            setAutoTestRunning(true);
            setAutoTestLatestProgress(data.content);
            // 同步写入开发日志区域，让"看看开发怎么说"Tab 也能看到工具调用过程
            appendDevProgress(data.content);
          }
        } else if (data.type === 'message') {
          // 测试报告到达：保留最近进度作为完成态文案，等用户切回看
          setAutoTestRunning(false);
          if (data.content) {
            // 保存完成摘要：ProgressTab 完成态展示（✅ 测试完成 + 摘要），直到下次测试
            setLastTestSummary(data.content);
            pushMessage({
              role: 'assistant',
              content: data.content,
              reasoning: data.reasoning,
              timestamp: data.timestamp,
            });
          }
          // 测试完成：稍后清理"最近进度"提示（避免长期残留）
          setTimeout(() => setAutoTestLatestProgress(null), 1500);
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
        setDevTaskRunning(false);
        setAutoTestRunning(false);
        setAutoTestLatestProgress(null);
        clearDevProgress();
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
    setLastTestSummary,
    appendDevProgress,
    clearDevProgress,
    pushMessage,
    setRequirements,
  ]);
}
