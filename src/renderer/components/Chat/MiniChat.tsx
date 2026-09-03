import { useEffect, useRef } from 'react';
import { useChatStore } from '../../store/chat';
import { useUiStore } from '../../store/ui';
import type { ElementInfo } from '@shared/types/preview';
import Marquee from '../Marquee';

interface MiniChatProps {
  placeholder?: string;
  /** 受控模式：外部传入当前输入值（如快捷选择卡自动填入指令） */
  value?: string;
  onValueChange?: (v: string) => void;
  /**
   * 处理中是否启用「跑马灯」动画。默认 false（保持静态文案，避免给主右窗造成视觉负担）；
   * preview 视图 AssistantPanel 内嵌的 MiniChat 需要明显的「还在跑」指示，传 true 启用。
   */
  marqueeOnProcessing?: boolean;
  /** 跑马灯文案（默认「正在处理中」） */
  marqueeText?: string;
  /**
   * v0.1.02 P1-4：选中元素上下文。
   * 传入后，本 MiniChat 发送的消息会强制带上 `selectedElement`，覆盖 chat store 中的全局值。
   * - ElementInspector 内的 MiniChat 应该始终传 selectedElement（验收前是空上下文，DSH 收不到元素描述）
   * - 顶部全局 DraggableChat 不传，沿用 store 的全局 selectedElement（用户手动从预览选中时已经写入 store）
   */
  elementContext?: ElementInfo | null;
}

/** 迷你对话（右侧面板内嵌）：最近消息 + 输入框；发送走主对话流，选中元素时自动带上元素上下文 */
export default function MiniChat({
  placeholder = '输入消息，Enter 发送…',
  value,
  onValueChange,
  marqueeOnProcessing = false,
  marqueeText,
  elementContext,
}: MiniChatProps) {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const sendMessage = useChatStore((s) => s.sendMessage);
  // v3.2.1 P1-3：非受控模式下读 ui store 的 chatDraft 与 DraggableChat 共享
  const storeDraft = useUiStore((s) => s.chatDraft);
  const setStoreDraft = useUiStore((s) => s.setChatDraft);
  const clearStoreDraft = useUiStore((s) => s.clearChatDraft);
  const scrollRef = useRef<HTMLDivElement>(null);
  // v3.2.1 P3-3b：发送后保持输入框焦点，方便连续追问
  const inputRef = useRef<HTMLInputElement>(null);
  // MiniChat 只呈现对话本身（用户/助理），跳过 system 状态通知（开发完成、错误等已在主对话中居中展示）
  const recent = messages.filter((m) => m.role !== 'system').slice(-6);

  // 受控模式：value/onValueChange 同时提供时，输入值由外部接管
  const controlled = value !== undefined && onValueChange !== undefined;
  const current = controlled ? (value as string) : storeDraft;
  const setCurrent = controlled
    ? (onValueChange as (v: string) => void)
    : (v: string) => setStoreDraft(v);

  useEffect(() => {
    // v3.2.1 P3-4：使用 behavior: 'smooth' 让新消息弹出更柔和
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const text = current.trim();
    if (!text || isProcessing) return;
    // v0.1.02 P1-4：传入 elementContext 时，把它强制作为本次发送的 selectedElement。
    // 注意：当 elementContext 为 null/undefined 时，不传 options，让 sendMessage 沿用 store 中的全局值。
    //
    // 修复 P0-4：把 elementContext 的可读描述塞进 message metadata.contextElement，
    // Message.tsx 据此在气泡上渲染"关于 [元素]"角标。让用户识别"这条消息是关于哪个 UI 元素"，
    // 避免双输入框（DraggableChat / ElementInspector）跨场景时的上下文串台。
    // ElementInfo 上没有 description 字段，合成一个简短的 "tag (selector)" 作为角标显示。
    const elCtx = elementContext ?? null;
    const metadata = elCtx
      ? {
          contextElement: {
            description: `${elCtx.tag} · ${elCtx.selector}`,
            tag: elCtx.tag,
            selector: elCtx.selector,
          },
        }
      : undefined;
    void sendMessage(
      text,
      elCtx ? { selectedElement: elCtx, metadata } : metadata ? { metadata } : undefined,
    );
    if (controlled) {
      // 受控模式：通知外部受控者清空，避免下次显示旧值
      onValueChange?.('');
    } else {
      // v3.2.1 P1-3：非受控模式统一清空全局草稿
      clearStoreDraft();
    }
    // v3.2.1 P3-3b：发送后保持输入框焦点，方便连续追问。
    // ElementInspector 内的 MiniChat 是单次编辑场景，焦点也保留，用户可能想接着追问修改。
    queueMicrotask(() => inputRef.current?.focus());
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
        {isProcessing && marqueeOnProcessing && (
          <Marquee
            variant="emerald"
            speed="normal"
            text={marqueeText ?? 'AI 正在处理中'}
            height="tight"
            className="mt-1"
            dataTestid="fc-minichat-marquee"
          />
        )}
        {isProcessing && !marqueeOnProcessing && (
          <div className="py-1 text-center text-slate-400">AI 正在处理…</div>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          ref={inputRef}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          onKeyDown={(e) => {
            // v3.2.1 P3-1：Enter 直接发送（输入框为单行 <input>，无换行需求）。
            // v3.2.1 P1-5：去掉「Shift+Enter 换行」误导——单行 input 根本不支持换行。
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          title="Enter 发送"
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
