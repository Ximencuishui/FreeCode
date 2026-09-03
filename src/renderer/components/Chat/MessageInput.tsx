import { useEffect, useRef, useState } from 'react';

interface MessageInputProps {
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
}

/** 输入区域：Enter 发送、Shift+Enter 换行、空态禁用（前端设计说明书 4.1） */
export default function MessageInput({
  disabled,
  placeholder = '输入消息，Enter 发送…',
  onSend,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = value.trim().length > 0 && !disabled;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        onSend(value);
        setValue('');
      }
    }
  };

  // v3.2.2 P3-1：进入对话页（且未禁用）时自动聚焦输入框，避免键盘用户
  // 每次都要先 Tab 一遍才能开始打字。useEffect 保证不抢初次渲染之前的焦点。
  useEffect(() => {
    if (disabled) return;
    const t = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [disabled]);

  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="对话输入框（Enter 发送，Shift+Enter 换行）"
        className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand disabled:bg-slate-50"
      />
      <button
        type="button"
        disabled={!canSend}
        onClick={() => {
          if (canSend) {
            onSend(value);
            setValue('');
          }
        }}
        className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-white transition-opacity hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        发送
      </button>
    </div>
  );
}
