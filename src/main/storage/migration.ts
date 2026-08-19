import type { StoredSettings } from './types';

/** 默认设置（数据库文档 3.1） */
export function defaultSettings(): StoredSettings {
  return {
    version: '1.0',
    projectsPath: '~/.freecoder/projects',
    language: 'zh-CN',
    darkMode: false,
    telemetryEnabled: false,
    preview: {
      autoOpen: true,
      portRange: [3000, 3010],
    },
    export: {
      includeDocker: true,
      includeReadme: true,
    },
    firstLaunch: true,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 设置迁移（数据库文档 5.2）：从任意旧版本迁移到当前版本。
 * 未知字段保留，缺失字段填充默认值。
 */
export function migrateSettings(raw: unknown): StoredSettings {
  const s = (raw ?? {}) as Partial<StoredSettings>;
  const base = defaultSettings();

  return {
    ...base,
    ...s,
    version: '1.0',
    telemetryEnabled: false,
    preview: {
      ...base.preview,
      ...(s.preview ?? {}),
    },
    export: {
      ...base.export,
      ...(s.export ?? {}),
    },
  };
}
