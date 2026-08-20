import type { ChatMessageUI, ChatOption } from '../../store/chat';
import { parseOptions } from '../../utils/options';
import OptionButtons from './OptionButtons';

interface MessageProps {
  message: ChatMessageUI;
  disabled?: boolean;
  onSelectOption: (option: ChatOption) => void;
}

/** 消息气泡（前端设计说明书 3.2） */
export default function Message({ message, disabled, onSelectOption }: MessageProps) {
  const options = message.options ?? parseOptions(message.content);

  if (message.role === 'system') {
    return (
      <div className="my-2 text-center text-xs text-slate-400">{message.content}</div>
    );
  }

  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[80%]">
        <div
          className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
            isUser
              ? 'rounded-br-sm bg-brand text-white'
              : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'
          }`}
        >
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
        {!isUser && (
          <OptionButtons options={options} disabled={disabled} onSelect={onSelectOption} />
        )}
      </div>
    </div>
  );
}
