import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat';

interface MiniChatProps {
  placeholder?: string;
  /** 受控模式：外部传入当前输入值（如快捷选择卡自动填入指令） */
  value?: string;
  onValueChange?: (v: string) => void;
}

/** 迷你对话（右侧面板内嵌）：最近消息 + 输入框；发送走主对话流，选中元素时自动带上元素上下文 */
export default function MiniChat({
  placeholder = '输入消息，Enter 发送…',
  value,
  onValueChange,
}: MiniChatProps) {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const [internal, setInternal] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  // MiniChat 只呈现对话本身（用户/助理），跳过 system 状态通知（开发完成、错误等已在主对话中居中展示）
  const recent = messages.filter((m) => m.role !== 'system').slice(-6);

  // 受控模式：value/onValueChange 同时提供时，输入值由外部接管
  const controlled = value !== undefined && onValueChange !== undefined;
  const current = controlled ? (value as string) : internal;
  const setCurrent = controlled ? (onValueChange as (v: string) => void) : setInternal;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = () => {
    const text = current.trim();
    if (!text || isProcessing) return;
    void sendMessage(text);
    setCurrent('');
  };

  return (
    <div className="rounded-xl border-2 border-black bg-white p-2 shadow-lg">
      <div
        ref={scrollRef}
        className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs"
      >
        {recent.length === 0 && (
          <p className="py-2 text-center text-slate-400">还没有对话，说点什么吧</p>
        )}
        {recent.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-2 py-1 leading-relaxed ${
                m.role === 'user'
                  ? 'bg-brand text-white'
                  : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {isProcessing && <div className="py-1 text-center text-slate-400">AI 正在处理…</div>}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={!current.trim() || isProcessing}
          onClick={send}
          className="rounded-lg bg-brand px-3 text-sm text-white disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}
