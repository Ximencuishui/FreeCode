/** 设置与 API Key 域类型（API 文档 4.5 / 4.6） */

/** 大模型提供商：DeepSeek 官方 / OpenAI 兼容自定义接口 */
export type LlmProviderKind = 'deepseek' | 'openai-compatible';

export interface AppSettings {
  apiKeyConfigured: boolean;
  /** 当前配置的提供商（未配置时为 deepseek 默认值，便于首次引导预填） */
  provider: LlmProviderKind;
  /** 自定义接口 Base URL（DeepSeek 官方或未配置时为空） */
  baseUrl?: string;
  /** 模型名（未配置时为空） */
  model?: string;
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
  provider?: LlmProviderKind;
  baseUrl?: string;
  model?: string;
}

export interface ApiKeySaveResult {
  success: boolean;
  error?: string;
}

export interface ApiKeyValidateParams {
  key: string;
  provider?: LlmProviderKind;
}

export interface ApiKeyValidateResult {
  valid: boolean;
  message?: string;
}
