import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useChatStore } from '../../store/chat';
import { useUiStore } from '../../store/ui';
import Marquee from '../Marquee';
import AiAssistantIcon from '../AiAssistantIcon';

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
const STORAGE_KEY_MIN = 'fc-draggable-chat:min-pos';

/** 把持久化的位置夹到当前视口内。
 * v0.1.02 P2-8：原来只校验 pos.x < window.innerWidth && pos.y < window.innerHeight，
 * 浮窗整体可能在视口外（4K 屏右下角拖到 1080p 屏后浮窗跑出可见区）。
 * 改进策略：
 *   1) 校验坐标必须是有限正数
 *   2) 视口尺寸过小（width<200 || height<120）放弃持久化位置，让浮窗回默认位置
 *   3) 极度越界（如 x ≥ 2 倍视口宽）：丢弃（保留旧测试 "localStorage 越界 → 用默认位置" 行为）
 *   4) 轻微越界（如多显示器切换 / 缩放窗口后）：夹到视口内，让浮窗仍可见
 */
function clampPos(pos: StoredPos, winWidth: number, winHeight: number, floatW: number, floatH: number): StoredPos | null {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  if (pos.x < 0 || pos.y < 0) return null;
  if (winWidth < 200 || winHeight < 120) return null;
  // 极度越界：视为非法位置，丢弃（与原 "out-of-viewport → 默认位置" 行为一致）
  if (pos.x >= winWidth * 2 || pos.y >= winHeight * 2) return null;
  // 至少留 60×40 可见区提示用户浮窗在那
  const visibleW = 60;
  const visibleH = 40;
  const minX = -(floatW - visibleW);
  const minY = -(floatH - visibleH);
  const maxX = winWidth - visibleW;
  const maxY = winHeight - visibleH;
  return {
    x: Math.max(minX, Math.min(pos.x, maxX)),
    y: Math.max(minY, Math.min(pos.y, maxY)),
  };
}

function readPos(): StoredPos | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredPos;
    return clampPos(v, window.innerWidth, window.innerHeight, 360, 300);
  } catch {
    /* 解析失败：忽略 */
  }
  return null;
}

/** 读取持久化的最小化图标位置（独立于展开态浮窗位置） */
function readMinPos(): StoredPos | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MIN);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredPos;
    // 圆形图标 48×48，可见区要求至少 24×24 落在视口内
    return clampPos(v, window.innerWidth, window.innerHeight, 48, 48);
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

function writeMinPos(pos: StoredPos): void {
  try {
    localStorage.setItem(STORAGE_KEY_MIN, JSON.stringify(pos));
  } catch {
    /* 写入失败：忽略 */
  }
}

/** 清空持久化的浮窗位置（重置到默认右下角） */
function clearPos(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_MIN);
  } catch {
    /* 忽略 */
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
 * - 顶部「⋮⋮ [图标] AI 助理」标题栏可拖动；位置持久化到 localStorage。
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

  // v3.2.1 P1-3：草稿上提到 ui store，与 MiniChat 共享，避免切换时输入丢失
  const input = useUiStore((s) => s.chatDraft);
  const setInput = useUiStore((s) => s.setChatDraft);
  const clearDraft = useUiStore((s) => s.clearChatDraft);

  const [pos, setPos] = useState<StoredPos | null>(() => readPos());
  const [minimized, setMinimized] = useState(false);
  /** 最小化图标位置（独立于展开态）。null 表示使用默认 bottom-right。 */
  const [minPos, setMinPos] = useState<StoredPos | null>(() => readMinPos());

  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    /** 当前拖的是哪个对象（'chat' = 展开态浮窗, 'icon' = 最小化图标） */
    target: 'chat' | 'icon';
    /** 本次拖动期间是否真的发生了位移（位移 ≥ 4px 视作拖动，不触发 click） */
    moved: boolean;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // 仅呈现对话本身（用户/助理），跳过 system 状态通知
  const recent = messages.filter((m) => m.role !== 'system').slice(-6);

  // 新消息时自动滚到底部
  // 兼容 jsdom 等不实现 HTMLElement.scrollTo 的测试环境：scrollTo 不是函数时静默跳过
  // v3.2.1 P3-4：使用 behavior: 'smooth' 提供平滑滚动，避免新消息弹出时视觉突兀
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  // 受控展开：外部 forceExpand=true 时强制展开（已主动最小化时不抢断）
  useEffect(() => {
    if (forceExpand) setMinimized(false);
  }, [forceExpand]);

  // v0.1.02 P2-8：监听窗口尺寸变化（多显示器插拔 / 缩放窗口），
  // 把持久化的位置重新夹到新视口内，避免浮窗被甩出可见区。
  useEffect(() => {
    const onResize = () => {
      setPos((p) => (p ? clampPos(p, window.innerWidth, window.innerHeight, 360, 300) : p));
      setMinPos((p) => (p ? clampPos(p, window.innerWidth, window.innerHeight, 48, 48) : p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // v0.1.02 P2-8：重置浮窗位置（清掉 localStorage + 回到默认右下角偏移）
  const resetPosition = () => {
    clearPos();
    setPos(null);
    setMinPos(null);
  };

  /** 拖动：mousedown 记录起点；mousemove 实时改 pos；mouseup 持久化位置。
   * v0.1.02 P2-9：把 target 抽出来，让展开态浮窗和最小化图标共用一套拖动逻辑。 */
  const startDrag = (e: ReactMouseEvent<HTMLElement>, target: 'chat' | 'icon') => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (containerRef.current as unknown as HTMLElement | null)?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
      target,
      moved: false,
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const nextX = d.origX + (ev.clientX - d.startX);
      const nextY = d.origY + (ev.clientY - d.startY);
      // 位移 ≥ 4px 才标记为拖动（避免轻微抖动误判）
      if (!d.moved && (Math.abs(ev.clientX - d.startX) >= 4 || Math.abs(ev.clientY - d.startY) >= 4)) {
        d.moved = true;
      }
      // 拖动期间：始终 clamp 到视口内（允许起点极端越界，因为用户是连续拖动过来的）
      const floatW = d.target === 'icon' ? 48 : 360;
      const floatH = d.target === 'icon' ? 48 : 300;
      const visibleW = 60;
      const visibleH = 40;
      const minX = -(floatW - visibleW);
      const minY = -(floatH - visibleH);
      const maxX = window.innerWidth - visibleW;
      const maxY = window.innerHeight - visibleH;
      const clampedPos: StoredPos = {
        x: Math.max(minX, Math.min(nextX, maxX)),
        y: Math.max(minY, Math.min(nextY, maxY)),
      };
      if (d.target === 'icon') {
        setMinPos(clampedPos);
      } else {
        setPos(clampedPos);
      }
    };
    const onUp = () => {
      const finalTarget = dragRef.current?.target;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // 拖动结束：保存位置到 localStorage
      if (containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        if (finalTarget === 'icon') {
          writeMinPos({ x: r.left, y: r.top });
        } else {
          writePos({ x: r.left, y: r.top });
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
  };

  // v3.2.1 P1-3：键盘等价拖动——标题栏聚焦后方向键移动浮窗（10px/次，Shift = 50px/次），
  // 屏幕阅读器 / 鼠标不可用用户也能调整浮窗位置。Home 回到默认右下角。
  const currentPos: StoredPos = pos ?? {
    x: window.innerWidth - width - 24,
    y: window.innerHeight - height - 24,
  };
  const moveBy = (dx: number, dy: number) => {
    const floatW = 360;
    const floatH = 300;
    const visibleW = 60;
    const visibleH = 40;
    const minX = -(floatW - visibleW);
    const minY = -(floatH - visibleH);
    const maxX = window.innerWidth - visibleW;
    const maxY = window.innerHeight - visibleH;
    const next: StoredPos = {
      x: Math.max(minX, Math.min(currentPos.x + dx, maxX)),
      y: Math.max(minY, Math.min(currentPos.y + dy, maxY)),
    };
    setPos(next);
    writePos(next);
  };
  const onHeaderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 已经被 input/textarea 占用的事件跳过（防御性，标题栏本身没 input）
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    const step = e.shiftKey ? 50 : 10;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveBy(-step, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveBy(step, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveBy(0, -step);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveBy(0, step);
        break;
      case 'Home':
        e.preventDefault();
        resetPosition();
        break;
      default:
        break;
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || isProcessing) return;
    void sendMessage(text);
    // v3.2.1 P1-3：发送成功后清空全局草稿，避免下次打开看到上次未发送内容
    clearDraft();
    // v3.2.1 P3-3b：发送后保持输入框焦点，方便连续追问。
    // 用微任务延后到 React 清完 store 草稿后再聚焦，避免被 onChange 抢断。
    queueMicrotask(() => inputRef.current?.focus());
  };

  // 受控隐藏：与 ElementInspector 内嵌 MiniChat 冲突时不渲染浮窗（位置/状态不受影响）
  if (hidden) return null;

  /* ===== 最小化态：右下角圆形图标 ===== */
  // v0.1.02 P2-9：圆形图标可拖动（拖到不挡 preview 操作的位置），位置独立持久化。
  // 用 dragRef.moved 标志区分 click vs drag：拖动后松开不会误触发展开。
  if (minimized) {
    const minStyle: CSSProperties = minPos
      ? { left: minPos.x, top: minPos.y, zIndex: zIndex + 1 }
      : { right: 24, bottom: 24, zIndex: zIndex + 1 };
    return (
      <div
        ref={containerRef as unknown as React.RefObject<HTMLDivElement>}
        data-testid="fc-draggable-chat-minimized"
        style={minStyle}
        onMouseDown={(e) => startDrag(e, 'icon')}
        onClick={(e) => {
          // 拖动后松开：mousedown 已经被识别为 drag (moved=true)，不展开
          if (dragRef.current?.moved) return;
          e.preventDefault();
          setMinimized(false);
        }}
        role="button"
        tabIndex={0}
        title="展开 AI 助理（也可拖动调整位置）"
        aria-label="展开 AI 助理"
        className="fixed flex h-12 w-12 cursor-move select-none items-center justify-center rounded-full bg-brand text-white shadow-lg transition-transform hover:scale-110"
      >
        {/* 最小化圆按钮：用 AiAssistantIcon 替代 🤖 emoji，28px 嵌入圆形按钮。 */}
        <AiAssistantIcon size={28} withSparkle />
      </div>
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
      // 主容器：#0E2A47（中深蓝）背景 + #1c4a7c 中等深蓝边框，与标题栏 #0a2238（最深）形成层级。
      // 阴影保留以维持"浮窗漂浮"感；外边框由 black → #1c4a7c 适配深色主题。
      className="fixed flex flex-col overflow-hidden rounded-xl border border-[#1c4a7c] bg-[#0E2A47] text-white shadow-2xl"
      style={style}
      data-testid="fc-draggable-chat"
    >
      {/* 标题栏：可拖动 + v3.2.1 P1-3 键盘等价（方向键移动，Home 复位） */}
      <div
        onMouseDown={(e) => startDrag(e, 'chat')}
        // v3.2.1 P3-3：拖动手柄 hover 加视觉反馈（⋮⋮ 变深色 + 整行高亮）
        // 让用户一眼看出"这里可以拖"。active 态（按下时）再加 inset shadow 表示正在拖。
        // v3.2.1 P1-3：可聚焦 + 键盘方向键移动，让屏幕阅读器 / 键盘用户也能调整浮窗位置。
        role="toolbar"
        tabIndex={0}
        aria-label="AI 助理浮窗标题（可拖动，方向键移动，Home 复位）"
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home Shift"
        onKeyDown={onHeaderKeyDown}
        // 标题栏：#0a2238 最深蓝，hover 升到 #14365c（中深蓝）形成"按压感"反馈。
        // focus 描边 #1c4a7c，与主容器边框同色，避免 brand 蓝在深色主题下对比度过弱。
        className="group flex shrink-0 cursor-move items-center justify-between border-b border-[#1c4a7c] bg-[#0a2238] px-2.5 py-1.5 select-none transition-colors hover:bg-[#14365c] active:bg-[#14365c] active:shadow-inner focus:outline-none focus:ring-2 focus:ring-[#1c4a7c]"
        data-testid="fc-draggable-chat-header"
        title="按住拖动浮窗，或聚焦后用方向键移动、Home 复位"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-white">
          {/* 拖动手柄：默认浅色，hover/active 变白，强化"这里可拖"的视觉提示 */}
          <span
            aria-hidden
            className="font-bold text-slate-400 transition-colors group-hover:text-white group-active:text-white"
          >
            ⋮⋮
          </span>
          {/* 标题栏内联 AI 助理图标：bare=true 不带方框背景，14px 与文字同行。withSparkle=false 避免小尺寸下闪光糊掉。 */}
          <AiAssistantIcon size={14} bare withSparkle={false} className="shrink-0" />
          AI 助理
        </span>
        <div className="flex items-center gap-0.5">
          {/* v0.1.02 P2-8：重置位置按钮 — 浮窗被拖到屏幕外时一键回到默认右下角。
              v3.2.1 P1-3：始终显示（不再仅在 pos 已定义时显示），让键盘用户也能找到复位入口。 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resetPosition();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="将浮窗移回默认右下角"
            aria-label="将浮窗移回默认右下角"
            data-testid="fc-draggable-chat-reset"
            className="flex h-6 w-6 items-center justify-center rounded text-base leading-none text-slate-300 transition-colors hover:bg-[#14365c] hover:text-white"
          >
            ↺
          </button>
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
            className="flex h-6 w-6 items-center justify-center rounded text-base leading-none text-slate-300 transition-colors hover:bg-[#14365c] hover:text-white"
          >
            −
          </button>
        </div>
      </div>

      {/* 消息流：与主容器同色 #0E2A47，让消息气泡 #14365c 自然浮起。 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[#0E2A47] p-2 text-xs"
        data-testid="fc-draggable-chat-messages"
      >
        {recent.length === 0 && (
          /* 空态：浅灰文字在 #0E2A47 上仍有可读对比 */
          <p className="py-2 text-center text-slate-300">还没有对话，说点什么吧</p>
        )}
        {recent.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {/* 规范：用户/AI 统一 #14365c（中深蓝）+ 白字，避免气泡在深色背景下刺眼。
                仅保留左右对齐区分身份，不靠颜色区分。 */}
            <div
              className="max-w-[88%] whitespace-pre-wrap rounded-lg bg-[#14365c] px-2 py-1 leading-relaxed text-white"
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
          /* 处理中提示：浅灰文字，深色背景下对比度足够 */
          <div className="py-1 text-center text-slate-300">AI 正在处理…</div>
        )}
      </div>

      {/* 输入框：输入区容器与标题栏同色 #0a2238（最深），形成"上下边框包围"的层级感 */}
      <div className="shrink-0 border-t border-[#1c4a7c] bg-[#0a2238] p-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // v3.2.1 P3-1：单 Enter 直接发送（输入框为单行 <input>，无换行需求）。
              // v3.2.1 P1-5：去掉 title 与注释里的「Shift+Enter 换行」误导——单行 input
              // 根本不支持换行，提示用户按 Shift+Enter 只会让人困惑。
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
            placeholder={placeholder}
            title="Enter 发送"
            data-testid="fc-draggable-chat-input"
            // 输入框：#14365c 背景 + 白字 + #1c4a7c 边框，与气泡同色形成"对话-输入"视觉连贯
            className="min-w-0 flex-1 rounded-lg border border-[#1c4a7c] bg-[#14365c] px-2.5 py-1.5 text-sm text-white placeholder:text-slate-300 outline-none focus:border-[#1c4a7c] focus:ring-2 focus:ring-[#1c4a7c]"
          />
          {/* 发送按钮保留 bg-brand（视觉锚点）：避免深色主题下操作入口被吞没。 */}
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