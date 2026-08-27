import { IpcChannels } from '../../shared/types/ipc';
import type {
  AppSettings,
  SettingsGetResult,
  SettingsUpdateParams,
  SettingsUpdateResult,
} from '../../shared/types/settings';
import type { StorageManager } from '../storage/types';
import type { StoredSettings } from '../storage/types';
import { handleIpc, IpcError } from './helpers';

/** 脱敏展示已配置的 API Key（仅保留前缀与末尾 4 位），避免明文进入渲染层 */
function maskApiKey(key: string | null): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return '****';
  const head = key.startsWith('sk-') ? 'sk-' : '';
  return `${head}****${key.slice(-4)}`;
}

/** 设置域 IPC（API 文档 4.5），基于本地存储持久化 */
export function registerSettingsIpc(storage: StorageManager): void {
  handleIpc<undefined, SettingsGetResult>(IpcChannels.settingsGet, async () => {
    const s = await storage.getSettings();
    const apiKey = await storage.loadApiKey();
    const settings: AppSettings = {
      apiKeyConfigured: apiKey !== null,
      apiKeyMasked: maskApiKey(apiKey),
      provider: s.provider ?? 'deepseek',
      baseUrl: s.baseUrl,
      model: s.model,
      lastOpenedProject: s.lastOpenedProject,
      projectsPath: s.projectsPath,
      language: s.language,
      darkMode: s.darkMode,
      telemetryEnabled: false,
    };
    return { settings };
  });

  handleIpc<SettingsUpdateParams, SettingsUpdateResult>(
    IpcChannels.settingsUpdate,
    async (_event, params) => {
      if (!params || Object.keys(params).length === 0) {
        throw new IpcError('INVALID_PARAMS', '没有可更新的设置项');
      }
      const updates: Partial<StoredSettings> = {};
      if (params.projectsPath !== undefined) updates.projectsPath = params.projectsPath;
      if (params.language !== undefined) updates.language = params.language;
      if (params.darkMode !== undefined) updates.darkMode = params.darkMode;
      await storage.saveSettings(updates);
      return { success: true };
    },
  );
}
