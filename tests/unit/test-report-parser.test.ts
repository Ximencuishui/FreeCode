/**
 * 自动测试报告结构化解析单元测试。
 *
 * 输入是 DSH 在 buildAutoTestTask 指引下输出的"JSON 机器段 + Markdown 用户段"双段文本。
 * 解析器负责抽取并归一化 verdict / issues / summary / fullReport。
 */
import { parseStructuredTestReport } from '../../src/main/dsh/testReportParser';

describe('自动测试报告解析器', () => {
  it('正确解析完整的 JSON 段：verdict / issues / summary / verdictLabel 全部抽取', () => {
    const reply = [
      '```json',
      JSON.stringify({
        verdict: 'warn',
        verdict_label: '有 1 个中等问题',
        summary: '整体可上线，但需要修复登录按钮颜色',
        issues: [
          {
            severity: 'medium',
            title: '登录按钮颜色对比度不足',
            detail: '深灰色按钮在浅色背景下对比度仅 2.1，影响可访问性',
            file: 'style.css:88',
          },
        ],
      }),
      '```',
      '',
      '✅ 通过的检查',
      '- 页面加载正常',
      '',
      '⚠️ 发现的问题（中）',
      '1. 登录按钮颜色对比度不足',
      '',
      '🔧 修复建议',
      '调整 style.css:88 的 background-color',
      '',
      '📋 总体结论：可上线，建议修复后导出',
    ].join('\n');

    const out = parseStructuredTestReport(reply);
    expect(out.verdict).toBe('warn');
    expect(out.verdictLabel).toBe('有 1 个中等问题');
    expect(out.summary).toBe('整体可上线，但需要修复登录按钮颜色');
    expect(out.issues).toEqual([
      {
        severity: 'medium',
        title: '登录按钮颜色对比度不足',
        detail: '深灰色按钮在浅色背景下对比度仅 2.1，影响可访问性',
        file: 'style.css:88',
      },
    ]);
    // fullReport 应剥掉 JSON 段后保留剩余人类可读部分
    expect(out.fullReport).not.toContain('```json');
    expect(out.fullReport).toContain('✅ 通过的检查');
    expect(out.fullReport).toContain('总体结论');
  });

  it('归一化 verdict 字符串变体：warning/blocked 映射到 warn/block', () => {
    expect(
      parseStructuredTestReport('```json\n{"verdict":"blocked","issues":[]}\n```').verdict,
    ).toBe('block');
    expect(
      parseStructuredTestReport('```json\n{"verdict":"warning","issues":[]}\n```').verdict,
    ).toBe('warn');
    // 不在枚举内 → 降级为 warn，不阻塞 UI
    expect(parseStructuredTestReport('```json\n{"verdict":"maybe","issues":[]}\n```').verdict).toBe(
      'warn',
    );
  });

  it('issues 排序无关：仅保留有 title 的条目，severity 归一化', () => {
    const reply = [
      '```json',
      JSON.stringify({
        verdict: 'block',
        summary: '阻塞问题',
        issues: [
          { severity: 'Low', title: '缓存说明缺失' }, // 大小写不敏感
          { severity: 'critical', title: '登录态丢失' }, // 别名 → high
          { title: '孤立的 title-only 条目' }, // 缺 severity → low
          { detail: '没有 title 的条目应当被丢弃' },
          { severity: 'high', title: '严重 XSS' },
        ],
      }),
      '```',
      '📋 总体结论：阻塞',
    ].join('\n');

    const out = parseStructuredTestReport(reply);
    expect(out.issues).toHaveLength(4);
    const titles = out.issues.map((i) => i.title);
    expect(titles).toContain('登录态丢失');
    expect(titles).toContain('孤立的 title-only 条目');
    expect(titles).toContain('严重 XSS');
    expect(titles).toContain('缓存说明缺失');
    // critical → high；low → low；缺省 → low
    const severityByTitle = Object.fromEntries(out.issues.map((i) => [i.title, i.severity]));
    expect(severityByTitle['登录态丢失']).toBe('high');
    expect(severityByTitle['严重 XSS']).toBe('high');
  });

  it('解析失败：JSON 不合法时降级为 warn 并保留原文', () => {
    const reply = '这份报告没有任何机器段，AI 直接写了一堆结论';
    const out = parseStructuredTestReport(reply);
    expect(out.verdict).toBe('warn');
    expect(out.issues).toEqual([]);
    expect(out.fullReport).toBe(reply);
  });

  it('解析失败：缺关键字段时降级为 warn', () => {
    const reply = '```json\n{"foo":"bar"}\n```\n后面是人类报告';
    const out = parseStructuredTestReport(reply);
    expect(out.verdict).toBe('warn');
    expect(out.issues).toEqual([]);
    expect(out.fullReport).not.toContain('```json');
    expect(out.fullReport).toContain('后面是人类报告');
  });

  it('空输入返回空 fullReport + warn', () => {
    const out = parseStructuredTestReport('');
    expect(out.verdict).toBe('warn');
    expect(out.issues).toEqual([]);
    expect(out.fullReport).toBe('');
  });

  it('pass 报告：issues 为空，fullReport 含通过检查段', () => {
    const reply = [
      '```json',
      JSON.stringify({
        verdict: 'pass',
        verdict_label: '可上线',
        summary: '全部检查通过',
        issues: [],
      }),
      '```',
      '✅ 通过的检查',
      '- 文件齐全',
      '- 启动正常',
      '📋 总体结论：可上线',
    ].join('\n');

    const out = parseStructuredTestReport(reply);
    expect(out.verdict).toBe('pass');
    expect(out.issues).toEqual([]);
    expect(out.summary).toBe('全部检查通过');
    expect(out.fullReport).toContain('文件齐全');
  });
});
