/**
 * UI 状态：当前视图（对话 / 预览）、API Key 配置弹窗、API 配置状态。
 */
import { create } from 'zustand';

export type AppView = 'chat' | 'preview';

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
}));
