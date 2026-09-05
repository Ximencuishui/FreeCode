/** UI 状态：当前主工作区、API Key 配置弹窗、API 配置状态。 */
import { create } from 'zustand';

/**
 * P0 建议 3：全局轻量通知（用于「应用已就绪，可以部署了」等边沿事件）。
 *
 * 设计取舍：
 *   - 数组而非单值：多个事件同时触发不互相覆盖；host 组件按入队顺序渲染。
 *   - 不接第三方 toast 库：项目依赖极简（grep react-hot-toast/sonner/notistack 全空），
 *     自渲染右下角浮层 + setTimeout 自动消失，足够支撑「边沿事件反馈」一类场景。
 *   - id 由 pushNotification 生成（Date.now() + 随机后缀），保证 React key 稳定；
 *     同一文本重复 push 也会产生不同 id，不会被去重拦截（去重交给调用方决定）。
 *   - 持久化交给 NotificationHost 内部的 setTimeout，不污染 store：
 *     切项目 / 路由刷新时未消失的通知会被 React 卸载，不影响主流程。
 */
export type NotificationKind = 'success' | 'info' | 'warning';

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  icon?: string;
  message: string;
  action?: NotificationAction;
  /** 自动消失毫秒数；0 或 undefined 表示不自动消失（必须用户手动 dismiss） */
  autoDismissMs?: number;
  createdAt: number;
}

/**
 * 主工作区视图枚举。
 * v3.2.2 P0-1 重构：'deploy' 从原来的「弹窗」改为「持久化视图」，
 * 与 chat / preview / documents 平等出现在 header 切换 Tab 上；
 * 原来 useExportStore.visible/open/close 的模态控制逻辑全部移除。
 */
export type AppView = 'chat' | 'preview' | 'documents' | 'deploy';

interface UiState {
  currentView: AppView;
  setView: (view: AppView) => void;
  /** API Key 设置弹窗是否打开（首次启动引导 + 顶部齿轮按钮共用） */
  settingsOpen: boolean;
  /** 是否为首启欢迎态（仅 openInvite 原子设置；标题栏据此显示"欢迎使用"文案） */
  inviteMode: boolean;
  /** 手动打开设置（非欢迎态） */
  openSettings: () => void;
  /** 首启自动打开设置（欢迎态，与 settingsOpen 原子更新，避免时序竞态） */
  openInvite: () => void;
  closeSettings: () => void;
  /** 是否已配置大模型 API（null = 尚未从主进程加载） */
  apiKeyConfigured: boolean | null;
  setApiKeyConfigured: (v: boolean) => void;
  /**
   * AI 助理聊天浮窗是否隐藏（preview 视图选中元素进入 🔍 Tab 时由 AssistantPanel 设置），
   * 避免和 ElementInspector 内嵌的修改指令 MiniChat 形成两个输入框并存的认知负担。
   * 跨视图（chat ↔ preview）持久：切回 chat 视图应保持当前隐藏状态。
   */
  aiChatHidden: boolean;
  setAiChatHidden: (v: boolean) => void;
  /**
   * v3.2.1 P1-3：聊天浮窗输入草稿（DraggableChat / MiniChat 共享）。
   * 之前两个组件各自维护 useState，切换时输入会丢失。
   * 提到全局 store 后，发送完或最小化后草稿可被统一清空，跨视图切换也保持一致。
   */
  chatDraft: string;
  setChatDraft: (v: string) => void;
  clearChatDraft: () => void;
  /**
   * P0 建议 3：全局通知队列。NotificationHost 在 App.tsx 顶层订阅并渲染。
   * pushNotification 自动追加并返回 id（方便调用方后续 dismiss）；
   * dismissNotification 移除指定 id；dismissAll 清空（切项目时调用）。
   */
  notifications: NotificationItem[];
  pushNotification: (input: Omit<NotificationItem, 'id' | 'createdAt'>) => string;
  dismissNotification: (id: string) => void;
  dismissAllNotifications: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  currentView: 'chat',
  setView: (view) => set({ currentView: view }),
  settingsOpen: false,
  inviteMode: false,
  openSettings: () => set({ settingsOpen: true, inviteMode: false }),
  openInvite: () => set({ settingsOpen: true, inviteMode: true }),
  closeSettings: () => set({ settingsOpen: false, inviteMode: false }),
  apiKeyConfigured: null,
  setApiKeyConfigured: (v) => set({ apiKeyConfigured: v }),
  aiChatHidden: false,
  setAiChatHidden: (v) => set({ aiChatHidden: v }),
  chatDraft: '',
  setChatDraft: (v) => set({ chatDraft: v }),
  clearChatDraft: () => set({ chatDraft: '' }),
  notifications: [],
  pushNotification: (input) => {
    // id 用时间戳 + 随机后缀保证唯一（同一毫秒内多次 push 也不会冲突）
    const id = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({
      notifications: [...state.notifications, { ...input, id, createdAt: Date.now() }],
    }));
    return id;
  },
  dismissNotification: (id) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),
  dismissAllNotifications: () => set({ notifications: [] }),
}));
