import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useChatStore } from '../../store/chat';
import Marquee from '../Marquee';

interface DraggableChatProps {
  placeholder?: string;
  /** 处理中是否启用「跑马灯」动画 */
  marqueeOnProcessing?: boolean;
  /** 跑马灯文案（默认「正在处理中」） */
  marqueeText?: string;
  /** 浮窗展开态尺寸（像素） */
  width?: number;
  height?: number;
  /** 受控模式：外部强制展开（如自动测试进行中） */
  forceExpand?: boolean;
  /** 最小化态 z-index；展开态 z-index 比它高 1，确保点击圆形图标时点击穿透到按钮 */
  zIndex?: number;
  /**
   * 受控隐藏：true 时整个浮窗与圆形图标都不渲染（用于和 ElementInspector 内嵌 MiniChat 冲突时）。
   * 默认 false（始终显示）。位置状态不受隐藏影响：再次显示时恢复原位。
   */
  hidden?: boolean;
}

interface StoredPos {
  x: number;
  y: number;
}

const STORAGE_KEY = 'fc-draggable-chat:pos';

/** 读取持久化的浮窗位置；窗口尺寸过小则放弃 */
function readPos(): StoredPos | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredPos;
    if (
      typeof v?.x === 'number' &&
      typeof v?.y === 'number' &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y) &&
      v.x >= 0 &&
      v.y >= 0 &&
      v.x < window.innerWidth &&
      v.y < window.innerHeight
    ) {
      return v;
    }
  } catch {
    /* 解析失败：忽略 */
  }
  return null;
}

function writePos(pos: StoredPos): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    /* 写入失败：忽略（隐私模式等） */
  }
}

/**
 * AI 助理聊天浮窗（可拖动 / 可最小化）。
 *
 * 设计动机：
 * - 原 `AssistantPanel` 底部固定 `MiniChat`，占用右窗底部约 100px 高度，
 *   挤压了 📌 进度 / 🔍 元素 / 💬 开发日志 Tab 的可用空间。
 * - 改为「浮窗」后，浮窗通过 fixed 定位脱离文档流，右窗底部空间完全让给 Tab 内容。
 *
 * 交互：
 * - 顶部「⋮⋮ 🤖 AI 助理」标题栏可拖动；位置持久化到 localStorage。
 * - 右上角「−」按钮：浮窗最小化为右下角圆形图标（点回弹）。
 * - 圆形图标点击：恢复浮窗到上次位置。
 * - 拖动期间限制在视口内，避免被拖到看不见的地方。
 */
export default function DraggableChat({
  placeholder = '输入消息，Enter 发送…',
  marqueeOnProcessing = false,
  marqueeText,
  width = 360,
  height = 300,
  forceExpand = false,
  zIndex = 40,
  hidden = false,
}: DraggableChatProps) {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const [input, setInput] = useState('');
  /** 浮窗位置（已拖动过）；null 表示使用默认右下角偏移 */
  const [pos, setPos] = useState<StoredPos | null>(() => readPos());
  const [minimized, setMinimized] = useState(false);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 仅呈现对话本身（用户/助理），跳过 system 状态通知
  const recent = messages.filter((m) => m.role !== 'system').slice(-6);

  // 新消息时自动滚到底部
  // 兼容 jsdom 等不实现 HTMLElement.scrollTo 的测试环境：scrollTo 不是函数时静默跳过
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages]);

  // 受控展开：外部 forceExpand=true 时强制展开（已主动最小化时不抢断）
  useEffect(() => {
    if (forceExpand) setMinimized(false);
  }, [forceExpand]);

  /** 拖动：mousedown 记录起点；mousemove 实时改 pos；mouseup 持久化位置 */
  const startDrag = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const nextX = d.origX + (ev.clientX - d.startX);
      const nextY = d.origY + (ev.clientY - d.startY);
      // 限制在视口内（保留 60px 可见以提示用户浮窗在那）
      const w = containerRef.current?.offsetWidth ?? width;
      const h = containerRef.current?.offsetHeight ?? height;
      const maxX = Math.max(0, window.innerWidth - 60);
      const maxY = Math.max(0, window.innerHeight - 40);
      setPos({
        x: Math.max(0, Math.min(nextX, maxX)),
        y: Math.max(0, Math.min(nextY, maxY - h + 40)),
      });
      // 避免选区干扰拖动
      void w;
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // 拖动结束：保存位置到 localStorage
      if (containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        writePos({ x: r.left, y: r.top });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
  };

  const send = () => {
    const text = input.trim();
    if (!text || isProcessing) return;
    void sendMessage(text);
    setInput('');
  };

  // 受控隐藏：与 ElementInspector 内嵌 MiniChat 冲突时不渲染浮窗（位置/状态不受影响）
  if (hidden) return null;

  /* ===== 最小化态：右下角圆形图标 ===== */
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        title="展开 AI 助理"
        aria-label="展开 AI 助理"
        data-testid="fc-draggable-chat-minimized"
        style={{ zIndex: zIndex + 1 }}
        className="fixed bottom-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-xl text-white shadow-lg transition-transform hover:scale-110"
      >
        🤖
      </button>
    );
  }

  /* ===== 展开态：浮窗（fixed 定位，脱离文档流） ===== */
  // 未拖动过时用 right/bottom 在右下角；拖动后用 left/top
  const style: CSSProperties = pos
    ? { left: pos.x, top: pos.y, width, height, zIndex }
    : { right: 24, bottom: 24, width, height, zIndex };

  return (
    <div
      ref={containerRef}
      className="fixed flex flex-col overflow-hidden rounded-xl border-2 border-black bg-white shadow-2xl"
      style={style}
      data-testid="fc-draggable-chat"
    >
      {/* 标题栏：可拖动 */}
      <div
        onMouseDown={startDrag}
        className="flex shrink-0 cursor-move items-center justify-between border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 select-none"
        data-testid="fc-draggable-chat-header"
        title="按住拖动浮窗"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
          <span aria-hidden className="text-slate-400">⋮⋮</span>
          🤖 AI 助理
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMinimized(true);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="最小化为圆形图标"
            aria-label="最小化"
            data-testid="fc-draggable-chat-minimize"
            className="flex h-6 w-6 items-center justify-center rounded text-base leading-none text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
          >
            −
          </button>
        </div>
      </div>

      {/* 消息流 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-slate-50 p-2 text-xs"
        data-testid="fc-draggable-chat-messages"
      >
        {recent.length === 0 && (
          <p className="py-2 text-center text-slate-400">还没有对话，说点什么吧</p>
        )}
        {recent.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
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
            dataTestid="fc-draggable-chat-marquee"
          />
        )}
        {isProcessing && !marqueeOnProcessing && (
          <div className="py-1 text-center text-slate-400">AI 正在处理…</div>
        )}
      </div>

      {/* 输入框 */}
      <div className="shrink-0 border-t border-slate-200 bg-white p-2">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder={placeholder}
            data-testid="fc-draggable-chat-input"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={!input.trim() || isProcessing}
            onClick={send}
            data-testid="fc-draggable-chat-send"
            className="rounded-lg bg-brand px-3 text-sm text-white disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}