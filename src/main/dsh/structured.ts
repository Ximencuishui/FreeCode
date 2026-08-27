import type { Requirements } from '../storage/types';
import type { VersionPlan } from '../../shared/types/project';

/**
 * 需求结构化输出解析（Hermes 结构化输出在 headless 模式下通过 prompt 约束实现）。
 * 从 DSH 回复中提取需求 JSON，映射为存储层 Requirements。
 */

export interface ParsedRequirements {
  project_name?: string;
  goal?: string;
  target_users?: string;
  core_features?: string[];
  use_scenarios?: string;
  data_requirements?: string[];
  visual_style?: string;
  platform?: 'web' | 'mini-program' | 'both';
  /** 主要页面/界面清单 */
  pages?: string[];
  /** 布局偏好 */
  layout?: string;
  /** 界面感觉（口语化） */
  style_feeling?: string;
  /** 主要使用设备 */
  device?: 'desktop' | 'mobile' | 'both';
  /** 关键操作流程 */
  key_flows?: string[];
  /** 登录方式 */
  authentication?: 'none' | 'password' | 'wechat' | 'sms';
  /** 使用规模 */
  usage_scale?: 'solo' | 'team' | 'public';
  /** 导出与分享需求 */
  export_features?: string[];
  /** 界面语言 */
  ui_language?: 'zh-CN' | 'en-US' | 'both';
}

/** 从回复文本中提取 JSON：优先代码块，其次整体，最后截取首尾大括号 */
export function tryExtractJson(reply: string): unknown | null {
  if (!reply) return null;

  // 1. ```json 代码块
  const block = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) {
    try {
      return JSON.parse(block[1].trim());
    } catch {
      /* 继续尝试其他方式 */
    }
  }

  // 2. 整体是 JSON
  try {
    return JSON.parse(reply.trim());
  } catch {
    /* 继续 */
  }

  // 3. 截取第一个 { 到最后一个 }
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(reply.slice(start, end + 1));
    } catch {
      /* 不是合法 JSON */
    }
  }
  return null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const items = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return items.length > 0 ? items.map((x) => x.trim()) : undefined;
}

/**
 * 解析需求卡片 JSON。
 * 核心字段（goal / target_users / core_features）必须存在才视为有效需求卡片；
 * 否则返回 null（对话继续，需求未收敛）。
 */
export function tryParseRequirements(reply: string): ParsedRequirements | null {
  const json = tryExtractJson(reply);
  if (!json || typeof json !== 'object') return null;

  const obj = json as Record<string, unknown>;
  const goal = asString(obj.goal);
  const targetUsers = asString(obj.target_users);
  const coreFeatures = asStringArray(obj.core_features);
  if (!goal || !targetUsers || !coreFeatures) return null;

  const platform = asString(obj.platform);
  const device = asString(obj.device);
  return {
    project_name: asString(obj.project_name) ?? asString(obj.name),
    goal,
    target_users: targetUsers,
    core_features: coreFeatures,
    use_scenarios: asString(obj.use_scenarios) ?? asString(obj.useScenarios),
    data_requirements: asStringArray(obj.data_requirements) ?? asStringArray(obj.dataRequirements),
    visual_style: asString(obj.visual_style) ?? asString(obj.visualStyle),
    platform: platform === 'mini-program' || platform === 'both' ? platform : 'web',
    pages: asStringArray(obj.pages),
    layout: asString(obj.layout),
    style_feeling: asString(obj.style_feeling) ?? asString(obj.styleFeeling),
    device: device === 'mobile' || device === 'both' ? device : 'desktop',
    key_flows: asStringArray(obj.key_flows) ?? asStringArray(obj.keyFlows),
    authentication: asAuth(obj.authentication),
    usage_scale: asScale(obj.usage_scale ?? obj.usageScale),
    export_features: asStringArray(obj.export_features) ?? asStringArray(obj.exportFeatures),
    ui_language: asLang(obj.ui_language ?? obj.uiLanguage),
  };
}

function asAuth(v: unknown): 'none' | 'password' | 'wechat' | 'sms' | undefined {
  const s = asString(v);
  if (s === 'password' || s === 'wechat' || s === 'sms') return s;
  if (s === 'none' || s === 'no') return 'none';
  return undefined;
}

function asScale(v: unknown): 'solo' | 'team' | 'public' | undefined {
  const s = asString(v);
  if (s === 'team' || s === 'public') return s;
  if (s === 'solo' || s === 'single' || s === 'personal') return 'solo';
  return undefined;
}

function asLang(v: unknown): 'zh-CN' | 'en-US' | 'both' | undefined {
  const s = asString(v);
  if (s === 'en-US' || s === 'en' || s === 'english') return 'en-US';
  if (s === 'both' || s === 'bilingual') return 'both';
  if (s === 'zh-CN' || s === 'zh' || s === 'chinese') return 'zh-CN';
  return undefined;
}

/** 将解析结果映射为存储层 Requirements（数据库文档 3.4） */
export function toRequirements(projectId: string, parsed: ParsedRequirements): Requirements {
  const now = new Date().toISOString();
  return {
    projectId,
    version: '1.0',
    confirmed: false,
    goal: parsed.goal ?? '',
    targetUsers: parsed.target_users ?? '',
    coreFeatures: parsed.core_features ?? [],
    useScenarios: parsed.use_scenarios,
    dataRequirements: parsed.data_requirements,
    visualStyle: parsed.visual_style,
    platform: parsed.platform,
    pages: parsed.pages,
    layout: parsed.layout,
    styleFeeling: parsed.style_feeling,
    device: parsed.device,
    keyFlows: parsed.key_flows,
    authentication: parsed.authentication,
    usageScale: parsed.usage_scale,
    exportFeatures: parsed.export_features,
    uiLanguage: parsed.ui_language,
    history: [{ version: 1, timestamp: now, changes: 'AI 助理生成需求' }],
    updatedAt: now,
  };
}

/**
 * 解析版本分段计划 JSON（AI 基于已确认需求生成的 MVP 切分建议）。
 * 要求：versions 为非空数组，每项含 label + features（非空）。
 * 否则返回 null（计划未生成，使用兜底计划）。
 */
export function tryParseVersionPlan(reply: string): VersionPlan | null {
  const json = tryExtractJson(reply);
  if (!json || typeof json !== 'object') return null;

  const obj = json as Record<string, unknown>;
  const rawVersions = obj.versions;
  if (!Array.isArray(rawVersions) || rawVersions.length === 0) return null;

  const versions = rawVersions
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({
      label: asString(v.label) ?? '',
      description: asString(v.description) ?? '',
      features: asStringArray(v.features) ?? [],
    }))
    .filter((v) => v.label && v.features.length > 0);

  if (versions.length === 0) return null;
  return { versions };
}

/**
 * 兜底版本计划：AI 未返回有效计划时使用。
 * V1 = 第一个核心功能（最小可用），其余功能归入 V2。
 */
export function fallbackVersionPlan(coreFeatures: string[]): VersionPlan {
  const first = coreFeatures[0] ?? '核心功能';
  const rest = coreFeatures.slice(1);
  const versions = [
    {
      label: 'V1',
      description: '最小可用版本（MVP）：先跑通最核心的功能',
      features: [first],
    },
  ];
  if (rest.length > 0) {
    versions.push({
      label: 'V2',
      description: '完善版本：在 V1 基础上补齐其余功能',
      features: rest,
    });
  }
  return { versions };
}
