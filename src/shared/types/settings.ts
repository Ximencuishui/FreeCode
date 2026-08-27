/** 设置与 API Key 域类型（API 文档 4.5 / 4.6） */

/** 大模型提供商：DeepSeek 官方 / OpenAI 兼容自定义接口 */
export type LlmProviderKind = 'deepseek' | 'openai-compatible';

export interface AppSettings {
  apiKeyConfigured: boolean;
  /** 已配置 Key 的脱敏展示（如 sk-****abcd；未配置时为空） */
  apiKeyMasked?: string;
  /** 当前配置的提供商（未配置时为 deepseek 默认值，便于首次引导预填） */
  provider: LlmProviderKind;
  /** 自定义接口 Base URL（DeepSeek 官方或未配置时为空） */
  baseUrl?: string;
  /** 模型名（未配置时为空） */
  model?: string;
  /** 上次打开的项目 ID（启动时恢复选中） */
  lastOpenedProject?: string;
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

/** 连接测试参数（与保存参数一致：用待验证的 Key 调端点 /models） */
export interface ApiKeyTestParams {
  key: string;
  provider?: LlmProviderKind;
  baseUrl?: string;
  model?: string;
}

export interface ApiKeyTestResult {
  success: boolean;
  /** 成功/失败的可读文案 */
  message?: string;
  /** 请求耗时（毫秒） */
  latencyMs?: number;
  /** 成功时端点返回的可用模型 id 列表（部分端点不返回，可为空） */
  models?: string[];
}

export interface ApiKeyValidateParams {
  key: string;
  provider?: LlmProviderKind;
}

export interface ApiKeyValidateResult {
  valid: boolean;
  message?: string;
}
