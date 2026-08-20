import { useEffect, useRef } from 'react';
import { useChatStore } from '../../store/chat';
import Message from './Message';
import MessageInput from './MessageInput';

/** 对话容器：消息流 + 输入区（前端设计说明书 3.2 / 2.1 主工作区） */
export default function ChatContainer() {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const pushMessage = useChatStore((s) => s.pushMessage);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isProcessing]);

  const handleSelectOption = (option: { label: string }) => {
    void sendMessage(option.label);
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="pt-16 text-center text-sm text-slate-400">
            您好！我是您的产品助理，今天想创造什么？
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
        {messages.length === 0 && !isProcessing && (
          <button
            type="button"
            onClick={() => void pushMessage({ role: 'system', content: '💡 说出您的想法，例如：我想做一个记账工具' })}
            className="mx-auto block text-xs text-slate-300 hover:text-slate-500"
          >
            查看使用提示
          </button>
        )}
      </div>
      <div className="border-t border-slate-200 p-3">
        <MessageInput disabled={isProcessing} onSend={(text) => void sendMessage(text)} />
      </div>
    </div>
  );
}
