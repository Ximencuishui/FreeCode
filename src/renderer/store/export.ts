/**
 * 导出状态。
 * v3.2.2 P0-1 重构：删除 visible / open / close 三个字段（原 DeployPanel 模态控制用）。
 * 「🚀 部署」现在是持久化视图（DeployView），由 uiStore.currentView 切换，
 * 不再需要导出层维护自己的可见性状态。
 */
import { create } from 'zustand';
import type { DeployConfig, ExportCompleteEvent } from '@shared/types/export';

export interface ExportState {
  /** 高级导出（DeployConfigWizard）是否正在打包 */
  exporting: boolean;
  /** 最近一次导出是否成功 */
  done: boolean;
  /** 导出产物的 zip 路径（成功时存在） */
  zipPath: string | null;
  /** 错误信息（失败时存在） */
  error: string | null;

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
    exporting: false,
    done: false,
    zipPath: null,
    error: null,

    startExport,
    reset: () => set({ exporting: false, done: false, error: null, zipPath: null }),
  };
});

/**
 * 处理 export:complete 事件（由 App 调用）。
 * v3.2.2 P0-5：增加 'cancelled' 分支 —— 切项目时主动取消的导出任务不算失败，
 * 不写 error、不弹 "导出失败"，让用户感知不到噪音；只把 exporting 置 false。
 */
export function handleExportComplete(data: ExportCompleteEvent): void {
  if (data.status === 'cancelled') {
    useExportStore.setState({ exporting: false });
    return;
  }
  useExportStore.setState({
    exporting: false,
    done: data.status === 'success',
    zipPath: data.zipPath ?? null,
    error: data.status === 'failed' ? (data.error ?? '导出失败') : null,
  });
}
