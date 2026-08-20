import { useEffect, useRef } from 'react';
import { useChatStore } from '../../store/chat';
import Message from './Message';
import MessageInput from './MessageInput';
import Logo from '../Logo';

/** 对话容器：消息流 + 输入区（前端设计说明书 3.2 / 2.1 主工作区） */
export default function ChatContainer() {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isProcessing]);

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
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex min-h-full flex-col items-center justify-center px-4 py-10 text-center">
            <Logo size={56} className="mb-4" />
            <p className="text-lg font-medium text-slate-700">您好！我是您的产品助理</p>
            <p className="mt-1.5 text-sm text-slate-400">
              说出您的想法，我来帮您把它变成可用的软件
            </p>
            <div className="mt-6 flex w-full max-w-md flex-col gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void sendMessage(s)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left text-sm text-slate-600 transition-colors hover:border-brand hover:bg-brand/5 hover:text-slate-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} disabled={isProcessing} onSelectOption={handleSelectOption} />
        ))}
        {isProcessing && (
          <div className="flex justify-start">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-400">
              正在思考…
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 p-3">
        <MessageInput disabled={isProcessing} onSend={(text) => void sendMessage(text)} />
      </div>
    </div>
  );
}
