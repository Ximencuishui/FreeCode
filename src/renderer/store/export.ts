/**
 * 导出状态。
 */
import { create } from 'zustand';
import type { DeployConfig } from '@shared/types/export';

export interface ExportState {
  visible: boolean;
  exporting: boolean;
  done: boolean;
  zipPath: string | null;
  error: string | null;

  open: () => void;
  close: () => void;
  startExport: (projectId: string, config?: DeployConfig) => Promise<void>;
  reset: () => void;
}

export const useExportStore = create<ExportState>((set) => {
  const startExport = async (projectId: string, config?: DeployConfig) => {
    set({ exporting: true, done: false, error: null });
    try {
      await window.electron.export.start({ projectId, includeDocker: true, config });
      // 完成经 export:complete 事件到达（App 中订阅）
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'error' in err
          ? String((err as { error: { message: string } }).error.message)
          : '导出失败，请重试';
      set({ exporting: false, error: msg });
    }
  };

  return {
    visible: false,
    exporting: false,
    done: false,
    zipPath: null,
    error: null,

    open: () => set({ visible: true, exporting: false, done: false, error: null, zipPath: null }),
    close: () => set({ visible: false }),
    startExport,
    reset: () => set({ exporting: false, done: false, error: null, zipPath: null }),
  };
});

/** 处理 export:complete 事件（由 App 调用） */
export function handleExportComplete(data: {
  status: 'success' | 'failed';
  zipPath?: string;
  error?: string;
}): void {
  useExportStore.setState({
    exporting: false,
    done: data.status === 'success',
    zipPath: data.zipPath ?? null,
    error: data.status === 'failed' ? (data.error ?? '导出失败') : null,
  });
}
