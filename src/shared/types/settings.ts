/** 设置与 API Key 域类型（API 文档 4.5 / 4.6） */

export interface AppSettings {
  apiKeyConfigured: boolean;
  projectsPath: string;
  language: 'zh-CN' | 'en-US';
  darkMode: boolean;
  telemetryEnabled: false;
}

export interface SettingsGetResult {
  settings: AppSettings;
}

export interface SettingsUpdateParams {
  projectsPath?: string;
  language?: 'zh-CN' | 'en-US';
  darkMode?: boolean;
}

export interface SettingsUpdateResult {
  success: boolean;
  error?: string;
}

export interface ApiKeySaveParams {
  key: string;
}

export interface ApiKeySaveResult {
  success: boolean;
  error?: string;
}

export interface ApiKeyValidateParams {
  key: string;
}

export interface ApiKeyValidateResult {
  valid: boolean;
  message?: string;
}
