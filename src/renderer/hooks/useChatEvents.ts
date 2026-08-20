import { useEffect } from 'react';
import { useChatStore } from '../store/chat';

/** 订阅主进程事件：AI 响应流（chat:response）与信号推送（chat:signal） */
export function useChatEvents(): void {
  const setProcessing = useChatStore((s) => s.setProcessing);
  const pushMessage = useChatStore((s) => s.pushMessage);
  const setRequirements = useChatStore((s) => s.setRequirements);

  useEffect(() => {
    const unsubResponse = window.electron.chat.onResponse((data) => {
      if (data.type === 'thinking') {
        setProcessing(true);
      } else if (data.type === 'message') {
        pushMessage({
          role: 'assistant',
          content: data.content ?? '',
          timestamp: data.timestamp,
        });
        if (data.requirements) {
          setRequirements(data.requirements);
        }
        setProcessing(false);
      } else if (data.type === 'done') {
        setProcessing(false);
      }
    });

    const unsubSignal = window.electron.chat.onSignal((signal) => {
      pushMessage({
        role: 'system',
        content: signal.message,
        timestamp: signal.timestamp,
      });
    });

    return () => {
      unsubResponse();
      unsubSignal();
    };
  }, [setProcessing, pushMessage, setRequirements]);
}
