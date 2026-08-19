import type { Requirements } from '../storage/types';

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
  return {
    project_name: asString(obj.project_name) ?? asString(obj.name),
    goal,
    target_users: targetUsers,
    core_features: coreFeatures,
    use_scenarios: asString(obj.use_scenarios) ?? asString(obj.useScenarios),
    data_requirements: asStringArray(obj.data_requirements) ?? asStringArray(obj.dataRequirements),
    visual_style: asString(obj.visual_style) ?? asString(obj.visualStyle),
    platform: platform === 'mini-program' || platform === 'both' ? platform : 'web',
  };
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
    history: [{ version: 1, timestamp: now, changes: 'AI 助理生成需求' }],
    updatedAt: now,
  };
}
