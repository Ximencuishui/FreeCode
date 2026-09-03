/** UI 状态：当前主工作区、API Key 配置弹窗、API 配置状态。 */
import { create } from 'zustand';

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
}));
