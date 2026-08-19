import { IpcChannels } from '../../shared/types/ipc';
import type {
  AppSettings,
  SettingsGetResult,
  SettingsUpdateParams,
  SettingsUpdateResult,
} from '../../shared/types/settings';
import { handleIpc, IpcError } from './helpers';

/** WP-03 桩：内存态默认设置；持久化在 WP-04/WP-06（存储模块）落地 */
const memorySettings: AppSettings = {
  apiKeyConfigured: false,
  projectsPath: '~/.freecoder/projects',
  language: 'zh-CN',
  darkMode: false,
  telemetryEnabled: false,
};

/** 设置域 IPC（API 文档 4.5） */
export function registerSettingsIpc(): void {
  handleIpc<undefined, SettingsGetResult>(IpcChannels.settingsGet, () => ({
    settings: { ...memorySettings },
  }));

  handleIpc<SettingsUpdateParams, SettingsUpdateResult>(IpcChannels.settingsUpdate, (_event, params) => {
    if (!params || Object.keys(params).length === 0) {
      throw new IpcError('INVALID_PARAMS', '没有可更新的设置项');
    }
    if (params.projectsPath !== undefined) memorySettings.projectsPath = params.projectsPath;
    if (params.language !== undefined) memorySettings.language = params.language;
    if (params.darkMode !== undefined) memorySettings.darkMode = params.darkMode;
    return { success: true };
  });
}
