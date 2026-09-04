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
  /** 浮窗默认初始宽度（用户拉伸后会被 localStorage 覆盖） */
  width?: number;
  /** 浮窗默认初始高度（用户拉伸后会被 localStorage 覆盖） */
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

/** 持久化的浮窗几何信息（位置 + 尺寸）。v0.1.05 P1 加入，替代旧的 {x,y}。 */
interface StoredGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 仅位置（用于最小化图标，不带尺寸——图标固定 48×48）。 */
interface StoredPos {
  x: number;
  y: number;
}

/** Resize 方向：8 个 = 4 角 + 上/下/左/右 4 边。 */
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** localStorage 存储键
 * - GEOM：展开态浮窗的位置 + 尺寸（v0.1.05 起）
 * - POS_OLD：v0.1.04 及之前的旧格式，迁移一次后清理
 * - MIN：最小化图标位置（独立于展开态） */
const STORAGE_KEY_GEOM = 'fc-draggable-chat:geom';
const STORAGE_KEY_POS_OLD = 'fc-draggable-chat:pos';
const STORAGE_KEY_MIN = 'fc-draggable-chat:min-pos';

/** 浮窗最小尺寸限制（resize 时兜底）。
 * - 240 容纳输入框 + 发送按钮 + padding
 * - 160 容纳标题栏 + 至少 2 行消息 */
const MIN_W = 240;
const MIN_H = 160;
/** Resize handle 热区宽度（视觉无痕，鼠标移到边缘 ~8px 范围内触发 resize） */
const RESIZE_HANDLE = 8;

/** 把持久化的位置夹到当前视口内（仅位置，固定尺寸——给最小化图标用）。
 * v0.1.02 P2-8：原来只校验 pos.x < window.innerWidth && pos.y < window.innerHeight，
 * 浮窗整体可能在视口外（4K 屏右下角拖到 1080p 屏后浮窗跑出可见区）。
 * 改进策略：
 *   1) 校验坐标必须是有限正数
 *   2) 视口尺寸过小（width<200 || height<120）放弃持久化位置，让浮窗回默认位置
 *   3) 极度越界（如 x ≥ 2 倍视口宽）：丢弃（保留旧测试 "out-of-viewport → 默认位置" 行为）
 *   4) 轻微越界（如多显示器切换 / 缩放窗口后）：夹到视口内，让浮窗仍可见
 */
function clampPos(pos: StoredPos, winWidth: number, winHeight: number, floatW: number, floatH: number): StoredPos | null {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  if (pos.x < 0 || pos.y < 0) return null;
  if (winWidth < 200 || winHeight < 120) return null;
  // 极度越界：视为非法位置，丢弃
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

/** 把持久化的几何信息夹到当前视口 + 最小尺寸限制内。
 * v0.1.05 P1：扩展自原 clampPos，加入 w/h 维度的合法性校验。
 *   1) x/y 必须是有限正数（保留旧校验）
 *   2) w/h 必须是有限正数，且 ≥ MIN_W/MIN_H
 *   3) 视口过小（width<200 || height<120）放弃持久化
 *   4) 极度越界（≥ 2 倍视口）：丢弃
 *   5) 轻微越界：夹到视口内，并保证至少 60×40 可见区
 *   6) resize 后整体（x+w, y+h）超出视口：向内夹，让浮窗仍在屏幕内
 *   7) 调整左上/右上角后导致 x<0 或 y<0：夹到 0 */
function clampGeom(geom: StoredGeom, winWidth: number, winHeight: number): StoredGeom | null {
  const { x, y, w, h } = geom;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || w < MIN_W || h < MIN_H) return null;
  if (winWidth < 200 || winHeight < 120) return null;
  // 极度越界：丢弃
  if (x >= winWidth * 2 || y >= winHeight * 2) return null;
  // 至少 60×40 可见
  const visibleW = 60;
  const visibleH = 40;
  const minX = -(w - visibleW);
  const minY = -(h - visibleH);
  const maxX = Math.max(0, winWidth - visibleW);
  const maxY = Math.max(0, winHeight - visibleH);
  const cx = Math.max(minX, Math.min(x, maxX));
  const cy = Math.max(minY, Math.min(y, maxY));
  // resize 后整体超出视口：把右边/下边贴到视口边
  const cw = Math.min(w, Math.max(MIN_W, winWidth - cx));
  const ch = Math.min(h, Math.max(MIN_H, winHeight - cy));
  return { x: cx, y: cy, w: cw, h: ch };
}

/** 从 localStorage 读取持久化的几何信息。
 * v0.1.05 P1：兼容旧 {x,y} 格式——补默认值后迁移到新 key 并删旧 key。
 * 返回 null 时表示用默认右下角位置 + 默认尺寸渲染。 */
function readGeom(defaultW: number, defaultH: number): StoredGeom | null {
  try {
    // 优先读新格式
    const rawGeom = localStorage.getItem(STORAGE_KEY_GEOM);
    if (rawGeom) {
      const v = JSON.parse(rawGeom) as Partial<StoredGeom>;
      if (
        typeof v.x === 'number' &&
        typeof v.y === 'number' &&
        typeof v.w === 'number' &&
        typeof v.h === 'number'
      ) {
        const clamped = clampGeom(
          { x: v.x, y: v.y, w: v.w, h: v.h },
          window.innerWidth,
          window.innerHeight,
        );
        if (clamped) return clamped;
      }
    }
    // 兼容旧格式：旧 key 只有 {x,y}，尺寸用默认
    const rawOld = localStorage.getItem(STORAGE_KEY_POS_OLD);
    if (rawOld) {
      const v = JSON.parse(rawOld) as Partial<StoredPos>;
      if (typeof v.x === 'number' && typeof v.y === 'number') {
        const migrated: StoredGeom = { x: v.x, y: v.y, w: defaultW, h: defaultH };
        const clamped = clampGeom(migrated, window.innerWidth, window.innerHeight);
        // 迁移：写到新 key + 删除旧 key（一次完成）
        if (clamped) {
          try {
            localStorage.setItem(STORAGE_KEY_GEOM, JSON.stringify(clamped));
            localStorage.removeItem(STORAGE_KEY_POS_OLD);
          } catch {
            /* 忽略 */
          }
          return clamped;
        }
        // 旧数据 clamp 后无效，清理掉避免下次再尝试
        localStorage.removeItem(STORAGE_KEY_POS_OLD);
      }
    }
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

function writeGeom(geom: StoredGeom): void {
  try {
    localStorage.setItem(STORAGE_KEY_GEOM, JSON.stringify(geom));
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

/** 清空持久化的浮窗几何信息（重置到默认右下角 + 默认尺寸） */
function clearGeom(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_GEOM);
    localStorage.removeItem(STORAGE_KEY_POS_OLD);
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

  const [geom, setGeom] = useState<StoredGeom | null>(() => readGeom(width, height));
  const [minimized, setMinimized] = useState(false);
  /** 最小化图标位置（独立于展开态）。null 表示使用默认 bottom-right。 */
  const [minPos, setMinPos] = useState<StoredPos | null>(() => readMinPos());

  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW?: number;
    origH?: number;
    /** 当前拖/拉的是哪个目标：
     * - 'chat' = 拖动展开态浮窗
     * - 'icon' = 拖动最小化图标
     * - 'resize' = 拉伸浮窗（这时 origW/origH/dir 必填） */
    target: 'chat' | 'icon' | 'resize';
    /** resize 时用的方向（4 角 + 4 边） */
    dir?: ResizeDir;
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
  // 把持久化的位置/尺寸重新夹到新视口内，避免浮窗被甩出可见区。
  useEffect(() => {
    const onResize = () => {
      setGeom((g) => (g ? clampGeom(g, window.innerWidth, window.innerHeight) : g));
      setMinPos((p) => (p ? clampPos(p, window.innerWidth, window.innerHeight, 48, 48) : p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // v0.1.02 P2-8：重置浮窗位置（清掉 localStorage + 回到默认右下角偏移 + 默认尺寸）
  const resetPosition = () => {
    clearGeom();
    setGeom(null);
    setMinPos(null);
  };

  /** 拖动 / 拉伸：mousedown 记录起点；mousemove 实时改 geom；mouseup 持久化。
 * v0.1.05 P1：扩 target 增加 'resize' 分支，与 chat/icon 共用同一套 mousemove/mouseup。
 *
 * drag（target='chat'|'icon'）：只改位置（x, y）
 * resize（target='resize'）：按 dir 同时改 x/y/w/h，左/上方向 resize 时同步修正 x/y（保持对侧锚定） */
  const startDrag = (
    e: ReactMouseEvent<HTMLElement>,
    target: 'chat' | 'icon' | 'resize',
    dir?: ResizeDir,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (containerRef.current as unknown as HTMLElement | null)?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
      origW: rect.width,
      origH: rect.height,
      target,
      dir,
      moved: false,
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // 位移 ≥ 4px 才标记为拖动
      if (!d.moved && (Math.abs(ev.clientX - d.startX) >= 4 || Math.abs(ev.clientY - d.startY) >= 4)) {
        d.moved = true;
      }
      if (d.target === 'icon') {
        // 拖动最小化图标（48×48 固定）
        const floatW = 48;
        const floatH = 48;
        const visibleW = 60;
        const visibleH = 40;
        const minX = -(floatW - visibleW);
        const minY = -(floatH - visibleH);
        const maxX = window.innerWidth - visibleW;
        const maxY = window.innerHeight - visibleH;
        const clampedPos: StoredPos = {
          x: Math.max(minX, Math.min(d.origX + (ev.clientX - d.startX), maxX)),
          y: Math.max(minY, Math.min(d.origY + (ev.clientY - d.startY), maxY)),
        };
        setMinPos(clampedPos);
        return;
      }
      // 拖动 / resize 展开态浮窗
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      const baseW = d.origW || width;
      const baseH = d.origH || height;
      let nx = d.origX;
      let ny = d.origY;
      let nw = baseW;
      let nh = baseH;
      if (d.target === 'resize' && d.dir) {
        // 按方向计算新几何；左/上方向同时调整位置保持对侧锚定
        const affectsW = d.dir.includes('e') || d.dir.includes('w');
        const affectsH = d.dir.includes('n') || d.dir.includes('s');
        const growsW = d.dir.includes('e');
        const growsH = d.dir.includes('s');
        if (affectsW) {
          const newW = growsW ? baseW + dx : baseW - dx;
          // 限制最小尺寸
          nw = Math.max(MIN_W, newW);
          // 调整左边缘时同步修正 x（保持右边锚定）
          if (!growsW) nx = d.origX + (baseW - nw);
        }
        if (affectsH) {
          const newH = growsH ? baseH + dy : baseH - dy;
          nh = Math.max(MIN_H, newH);
          if (!growsH) ny = d.origY + (baseH - nh);
        }
      } else {
        // 纯拖动：只改位置
        nx = d.origX + dx;
        ny = d.origY + dy;
      }
      // clamp 到视口内：保证至少 60×40 可见区、整体不超出视口、x/y ≥ -(w-visibleW)
      const visibleW = 60;
      const visibleH = 40;
      const minX = -(nw - visibleW);
      const minY = -(nh - visibleH);
      const maxX = Math.max(0, window.innerWidth - visibleW);
      const maxY = Math.max(0, window.innerHeight - visibleH);
      const clampedX = Math.max(minX, Math.min(nx, maxX));
      const clampedY = Math.max(minY, Math.min(ny, maxY));
      // resize 后整体超出视口：把 w/h 收紧到视口内
      const clampedW = Math.max(MIN_W, Math.min(nw, window.innerWidth - clampedX));
      const clampedH = Math.max(MIN_H, Math.min(nh, window.innerHeight - clampedY));
      setGeom({ x: clampedX, y: clampedY, w: clampedW, h: clampedH });
    };
    const onUp = () => {
      const finalTarget = dragRef.current?.target;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // 拖动 / resize 结束：保存到 localStorage
      // 注意：resize 时**用 React state**而不是 DOM BCR 写尺寸；
      // 因为 React state 同步更新，但 DOM style.width 在某些环境（jsdom/未触发 layout）
      // 下不会同步，导致读到旧值。state 永远是真相。
      if (containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        setGeom((g) => {
          if (!g) return g;
          if (finalTarget === 'icon') {
            writeMinPos({ x: r.left, y: r.top });
          } else if (finalTarget === 'resize') {
            writeGeom({ x: g.x, y: g.y, w: g.w, h: g.h });
          } else {
            // 'chat'：x/y 从 BCR 读，w/h 不变
            writeGeom({ x: r.left, y: r.top, w: g.w, h: g.h });
          }
          return g;
        });
      }
    };
    const d = dragRef.current;
    if (!d) return;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // resize 时把鼠标光标设成对应方向，让用户视觉感知"在拉伸"
    if (d.dir === 'n' || d.dir === 's') document.body.style.cursor = 'ns-resize';
    else if (d.dir === 'e' || d.dir === 'w') document.body.style.cursor = 'ew-resize';
    else if (d.dir === 'ne' || d.dir === 'sw') document.body.style.cursor = 'nesw-resize';
    else if (d.dir === 'nw' || d.dir === 'se') document.body.style.cursor = 'nwse-resize';
    else document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
  };

  // v3.2.1 P1-3：键盘等价拖动——标题栏聚焦后方向键移动浮窗（10px/次，Shift = 50px/次），
  // 屏幕阅读器 / 鼠标不可用用户也能调整浮窗位置。Home 回到默认右下角。
  const currentGeom: StoredGeom = geom ?? {
    x: window.innerWidth - width - 24,
    y: window.innerHeight - height - 24,
    w: width,
    h: height,
  };
  const moveBy = (dx: number, dy: number) => {
    const nw = currentGeom.w;
    const nh = currentGeom.h;
    const visibleW = 60;
    const visibleH = 40;
    const minX = -(nw - visibleW);
    const minY = -(nh - visibleH);
    const maxX = window.innerWidth - visibleW;
    const maxY = window.innerHeight - visibleH;
    const next: StoredGeom = {
      x: Math.max(minX, Math.min(currentGeom.x + dx, maxX)),
      y: Math.max(minY, Math.min(currentGeom.y + dy, maxY)),
      w: nw,
      h: nh,
    };
    setGeom(next);
    writeGeom(next);
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
  // 未拖动过时用 right/bottom 在右下角；拖动或 resize 后用 left/top + width/height
  const style: CSSProperties = geom
    ? { left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex }
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

      {/* v0.1.07 P2（用户请求）：resize handles（8 个 = 4 角 + 左/下/右/上 4 边）。
          - 上方 'n' handle 左右各留 RESIZE_HANDLE = 8px，与 nw/ne 角落 handle 共享同一条 8px 边界，避免行为跳变
          - 'n' handle 与 header 是兄弟节点（都在主容器内），mousedown 事件不会跨兄弟冒泡，
            所以用户在 'n' handle 区域点击 → 触发 resize，header 其他区域 → 触发整体拖动，互不干扰
          - 每个 handle 宽度 RESIZE_HANDLE（约 8px），鼠标进入显示对应 cursor
          - onMouseDown 调用 startDrag('resize', dir)，复用拖动的全局 mousemove/mouseup
          - 视觉无痕（无背景色），但加 title + data-testid 方便测试与辅助技术识别 */}
      <div
        data-testid="fc-draggable-chat-resize-nw"
        title="拖动调整大小（左上）"
        onMouseDown={(e) => startDrag(e, 'resize', 'nw')}
        className="absolute left-0 top-0 cursor-nwse-resize"
        style={{ width: RESIZE_HANDLE, height: RESIZE_HANDLE }}
      />
      <div
        data-testid="fc-draggable-chat-resize-ne"
        title="拖动调整大小（右上）"
        onMouseDown={(e) => startDrag(e, 'resize', 'ne')}
        className="absolute right-0 top-0 cursor-nesw-resize"
        style={{ width: RESIZE_HANDLE, height: RESIZE_HANDLE }}
      />
      <div
        data-testid="fc-draggable-chat-resize-sw"
        title="拖动调整大小（左下）"
        onMouseDown={(e) => startDrag(e, 'resize', 'sw')}
        className="absolute bottom-0 left-0 cursor-nesw-resize"
        style={{ width: RESIZE_HANDLE, height: RESIZE_HANDLE }}
      />
      <div
        data-testid="fc-draggable-chat-resize-se"
        title="拖动调整大小（右下）"
        onMouseDown={(e) => startDrag(e, 'resize', 'se')}
        className="absolute bottom-0 right-0 cursor-nwse-resize"
        style={{ width: RESIZE_HANDLE, height: RESIZE_HANDLE }}
      />
      <div
        data-testid="fc-draggable-chat-resize-w"
        title="拖动调整宽度"
        onMouseDown={(e) => startDrag(e, 'resize', 'w')}
        className="absolute left-0 top-1/2 -translate-y-1/2 cursor-ew-resize"
        style={{ width: RESIZE_HANDLE, height: '100%' }}
      />
      <div
        data-testid="fc-draggable-chat-resize-e"
        title="拖动调整宽度"
        onMouseDown={(e) => startDrag(e, 'resize', 'e')}
        className="absolute right-0 top-1/2 -translate-y-1/2 cursor-ew-resize"
        style={{ width: RESIZE_HANDLE, height: '100%' }}
      />
      <div
        data-testid="fc-draggable-chat-resize-s"
        title="拖动调整高度"
        onMouseDown={(e) => startDrag(e, 'resize', 's')}
        className="absolute bottom-0 left-1/2 -translate-x-1/2 cursor-ns-resize"
        style={{ width: '100%', height: RESIZE_HANDLE }}
      />
      {/* v0.1.07 P2（用户请求）：顶部边缘 resize handle，让用户从顶部拉伸浮窗高度。
          - 与 nw/ne 角落 handle 无缝拼接：左右各留 RESIZE_HANDLE = 8px，避开 nw/ne 角落 handle 的 8×8 区域
            （让 edge handle 与 corner handle 共享同一条 8px 边界，避免鼠标在两者之间移动时行为跳变）
          - 与 header 不冲突：'n' handle 与 header 是兄弟节点，mousedown 不会跨兄弟冒泡
          - startDrag('resize', 'n') 已支持 'n' 方向（affectsH=true, growsH=false，
            保持底边锚定 + 高度跟随 dy 反向变化） */}
      <div
        data-testid="fc-draggable-chat-resize-n"
        title="拖动调整高度（顶部）"
        onMouseDown={(e) => startDrag(e, 'resize', 'n')}
        className="absolute left-2 right-2 top-0 cursor-ns-resize"
        style={{ height: RESIZE_HANDLE }}
      />
    </div>
  );
}