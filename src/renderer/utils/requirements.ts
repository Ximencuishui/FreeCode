/**
 * 需求收敛检测：从助理回复中提取需求 JSON（模型在收敛时输出
 * 「结束语 + ```json 代码块 + 引导语」，这里把 JSON 摘出来渲染成卡片，避免裸 JSON 吓到用户）。
 */

export interface ChatRequirementJson {
  project_name?: string;
  goal?: string;
  target_users?: string;
  core_features?: string[];
  pages?: string[];
  [key: string]: unknown;
}

/** 判断是否像「需求卡片」JSON（核心字段齐全才认为收敛） */
function looksLikeRequirement(v: unknown): v is ChatRequirementJson {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.goal === 'string' &&
    typeof o.target_users === 'string' &&
    Array.isArray(o.core_features)
  );
}

export interface RequirementExtract {
  /** 解析出的需求 JSON（未收敛为 null） */
  json: ChatRequirementJson | null;
  /** 去掉 JSON 后的正文（结束语 + 引导语） */
  cleaned: string;
}

/** 从回复中提取需求 JSON 与剩余正文 */
export function extractRequirementJson(content: string): RequirementExtract {
  if (!content) return { json: null, cleaned: content };

  // 1. ```json 代码块（模型收敛时按此格式输出）
  const block = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) {
    try {
      const obj = JSON.parse(block[1].trim()) as unknown;
      if (looksLikeRequirement(obj)) {
        const cleaned = content.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim();
        return { json: obj, cleaned };
      }
    } catch {
      /* 继续尝试其他方式 */
    }
  }

  // 2. 整体或截取首尾大括号
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(content.slice(start, end + 1)) as unknown;
      if (looksLikeRequirement(obj)) {
        const cleaned = (content.slice(0, start) + content.slice(end + 1)).trim();
        return { json: obj, cleaned };
      }
    } catch {
      /* 不是合法 JSON */
    }
  }

  return { json: null, cleaned: content };
}
