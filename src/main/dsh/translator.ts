import { sanitizeLog } from '../security/encryption';
import { signalRules } from './signals';
import type { SignalEvent } from '../../shared/types/chat';

export interface TranslateResult {
  message: string;
  suggestions?: string[];
  autoAction?: string;
}

/**
 * 信号翻译器：将 DSH 技术信号翻译为用户友好的自然语言。
 * 处理流程：脱敏 → 规则匹配 → 翻译；未知信号降级为 info（测试计划 UT-SIG-003）。
 */
export function translateSignal(raw: string): SignalEvent {
  const clean = sanitizeLog(raw);
  const timestamp = new Date().toISOString();

  for (const rule of signalRules) {
    const match = clean.match(rule.pattern);
    if (match) {
      const t = rule.translate(match);
      return {
        type: rule.category,
        message: t.message,
        suggestions: t.suggestions,
        autoAction: t.autoAction,
        code: clean,
        timestamp,
      };
    }
  }

  // 未知信号降级
  return {
    type: 'info',
    message: `[技术信息] ${clean}`,
    code: clean,
    timestamp,
  };
}
