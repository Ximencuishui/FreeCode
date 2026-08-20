/**
 * UI 状态：当前视图（对话 / 预览）。
 */
import { create } from 'zustand';

export type AppView = 'chat' | 'preview';

interface UiState {
  currentView: AppView;
  setView: (view: AppView) => void;
}

export const useUiStore = create<UiState>((set) => ({
  currentView: 'chat',
  setView: (view) => set({ currentView: view }),
}));
