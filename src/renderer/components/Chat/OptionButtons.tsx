import type { ChatOption } from '../../store/chat';

interface OptionButtonsProps {
  options: ChatOption[];
  disabled?: boolean;
  onSelect: (option: ChatOption) => void;
}

/** 选项按钮组：点击即答，选中后整组禁用（前端设计说明书 3.2） */
export default function OptionButtons({ options, disabled, onSelect }: OptionButtonsProps) {
  if (options.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(opt)}
          className="rounded-full border border-brand px-3 py-1 text-sm text-brand transition-colors hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-brand"
        >
          {opt.key}. {opt.label}
        </button>
      ))}
    </div>
  );
}
