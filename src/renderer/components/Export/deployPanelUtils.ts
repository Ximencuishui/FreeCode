import type { StructuredTestReport } from '@shared/types/project';

/**
 * 把结构化测试报告翻译成"通过率"展示文案。
 * v3.2.1 P0-2 修复：原实现用 `issues.filter(i => i.severity !== 'high').length / total`
 * 把"非高严重度问题数"误称为"通过率"，导致 UI 上 "3 / 5" 实际含义是"5 个问题里 3 个不是高严重度"。
 * 改用 verdict 直接判定通过状态，问题数仅在有真实问题时展示。
 *
 * @returns 展示文案；返回 undefined 表示尚未跑过测试（不渲染该项）
 */
export function formatTestPassRate(
  report: StructuredTestReport | null | undefined,
): string | undefined {
  if (!report) return undefined;
  const total = report.issues.length;
  const high = report.issues.filter((i) => i.severity === 'high').length;
  const medium = report.issues.filter((i) => i.severity === 'medium').length;
  const low = report.issues.filter((i) => i.severity === 'low').length;

  // verdict 是结构化报告的最终结论，与 issues 互为佐证；优先采用
  switch (report.verdict) {
    case 'pass':
      // 0 问题 → "全部通过"；少数低优问题 → 仍视为通过，但附数量
      if (total === 0) return '全部通过';
      if (high === 0 && medium === 0) return `全部通过（含 ${low} 个优化建议）`;
      // 兜底（理论上 pass 不应含 high/medium，但防御性保留）
      return `通过 · ${high + medium} 个非阻塞问题`;
    case 'warn':
      // 无阻塞、有非阻塞 → 视为可通过但需关注
      if (high === 0) {
        return `通过（有 ${medium + low} 个非阻塞问题）`;
      }
      return `有 ${high} 个阻塞问题`;
    case 'block':
      return `有 ${high} 个阻塞问题需修复`;
    default:
      // 未知 verdict 时退回 issue 数真相
      return total === 0 ? '全部通过' : `${total} 个问题`;
  }
}

/**
 * v3.2.1 P1-5：从开发日志条目中粗略统计"涉及到的代码文件数"。
 * 日志条目形如 `📝 写入 src/index.html` / `✏️ 编辑 app.js` 等，
 * 通过正则抽出 "写入/编辑 X" 后面的路径，去重计数。
 * 这是无新增 IPC 时的折中方案；精度依赖 dsh 的日志格式，但足以让里程碑卡不再空白。
 */
export function countFilesFromDevProgress(devProgress: readonly string[]): number {
  if (!devProgress || devProgress.length === 0) return 0;
  // 匹配形如 "📝 写入 xxx" / "✏️ 编辑 xxx" / "🛠 执行 xxx" 后面的文件路径
  // 取路径里第一个空白分隔后的 token 作为文件名
  const files = new Set<string>();
  const filePattern = /(?:写入|编辑|创建|生成|update|write|edit|create)\s+([^\s,，。；]+)/i;
  for (const line of devProgress) {
    const m = line.match(filePattern);
    if (m && m[1]) {
      // 去掉可能的前缀 ./ 或 /
      const cleaned = m[1].replace(/^[./\\]+/, '').trim();
      if (cleaned) files.add(cleaned);
    }
  }
  return files.size;
}