/**
 * 自动测试报告结构化解析。
 * 输入：DSH 在 buildAutoTestTask 指引下输出的"JSON 机器段 + Markdown 用户段"双段文本
 * 输出：结构化报告（verdict / issues / summary / fullReport），前端据此分流
 *
 * 设计要点：
 * - 复用 structured.ts 的 tryExtractJson 抽取首个 ```json 代码块
 * - 校验失败时降级为 verdict='warn' 且 issues=[]，把整段原始文本作为 fullReport，不阻塞 UI
 * - 把"机器段"剥离后剩余文本作为 fullReport，避免用户看到两份重复内容
 */
import type { StructuredTestReport } from '../../shared/types/project';
import { tryExtractJson } from './structured';

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * 归一化 verdict 字符串到枚举值；不在枚举内时降级为 'warn'。
 * 这样即使 AI 偶尔输出 "warning"/"blocked" 等变体也不会让 UI 失去引导。
 */
function asVerdict(v: unknown): StructuredTestReport['verdict'] {
  const s = asString(v)?.toLowerCase();
  if (s === 'pass' || s === 'ok' || s === 'success') return 'pass';
  if (s === 'block' || s === 'fail' || s === 'blocked' || s === 'error') return 'block';
  return 'warn';
}

function asSeverity(
  v: unknown,
): StructuredTestReport['issues'][number]['severity'] {
  const s = asString(v)?.toLowerCase();
  if (s === 'high' || s === 'critical' || s === '严重') return 'high';
  if (s === 'medium' || s === 'mid' || s === '中') return 'medium';
  if (s === 'low' || s === 'minor' || s === '低') return 'low';
  return 'low';
}

function asIssues(v: unknown): StructuredTestReport['issues'] {
  if (!Array.isArray(v)) return [];
  const out: StructuredTestReport['issues'] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    const title = asString(obj.title) ?? asString(obj.summary);
    if (!title) continue;
    out.push({
      severity: asSeverity(obj.severity),
      title,
      detail: asString(obj.detail) ?? asString(obj.description),
      file: asString(obj.file) ?? asString(obj.location),
    });
  }
  return out;
}

/**
 * 从 DSH 回复中解析结构化测试报告。
 * 解析失败/字段缺失时返回降级结果（verdict='warn'、issues=[]、fullReport=原文），
 * 保证 UI 始终能渲染完成态卡片。
 */
export function parseStructuredTestReport(reply: string): StructuredTestReport {
  if (!reply || !reply.trim()) {
    return { verdict: 'warn', issues: [], fullReport: reply ?? '' };
  }

  const json = tryExtractJson(reply);
  if (!json || typeof json !== 'object') {
    return { verdict: 'warn', issues: [], fullReport: reply };
  }

  const obj = json as Record<string, unknown>;
  const verdict = asVerdict(obj.verdict);
  const verdictLabel = asString(obj.verdict_label);
  const summary = asString(obj.summary);
  const issues = asIssues(obj.issues);

  // 剥掉首个 ```json ... ``` 代码块，剩下的就是给用户看的"完整报告"
  const fullReport = reply.replace(/```(?:json)?\s*[\s\S]*?```/, '').trim() || reply;

  return {
    verdict,
    verdictLabel,
    summary,
    issues,
    fullReport,
  };
}
