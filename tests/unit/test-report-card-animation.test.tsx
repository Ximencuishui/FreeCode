/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { TestReportCard } from '../../src/renderer/components/Preview/AssistantPanel';
import type { StructuredTestReport } from '../../src/shared/types/project';

/**
 * 测试完成态卡片动效单测（UT-ANIM-001~005）。
 *
 * 目的：确保 fadeIn / badgePop 动画类被正确挂载，避免后续重构误删；
 * 同时验证 prefers-reduced-motion 兼容（motion-safe: / motion-reduce:）。
 */

const baseReport: StructuredTestReport = {
  verdict: 'pass',
  verdictLabel: '可上线',
  summary: '一切正常',
  issues: [],
  fullReport: 'OK',
};

describe('TestReportCard 完成态动效类挂载', () => {
  it('UT-ANIM-001 根容器含 animate-fadeIn 类', () => {
    render(<TestReportCard report={baseReport} pending={null} onAction={() => undefined} />);
    const card = screen.getByTestId('auto-test-report-card');
    expect(card.className).toContain('animate-fadeIn');
  });

  it('UT-ANIM-002 verdict 徽章含 animate-badgePop 类', () => {
    render(<TestReportCard report={baseReport} pending={null} onAction={() => undefined} />);
    const badge = screen.getByTestId('auto-test-verdict-badge');
    expect(badge.className).toContain('animate-badgePop');
  });

  it('UT-ANIM-003 verdict 徽章含 origin-right 类（避免向左溢出）', () => {
    render(<TestReportCard report={baseReport} pending={null} onAction={() => undefined} />);
    const badge = screen.getByTestId('auto-test-verdict-badge');
    expect(badge.className).toContain('origin-right');
  });

  it('UT-ANIM-004 根容器含 motion-safe:animate-fadeIn（无障碍兼容）', () => {
    render(<TestReportCard report={baseReport} pending={null} onAction={() => undefined} />);
    const card = screen.getByTestId('auto-test-report-card');
    expect(card.className).toContain('motion-safe:animate-fadeIn');
  });

  it('UT-ANIM-005 verdict 徽章含 motion-safe:animate-badgePop（无障碍兼容）', () => {
    render(<TestReportCard report={baseReport} pending={null} onAction={() => undefined} />);
    const badge = screen.getByTestId('auto-test-verdict-badge');
    expect(badge.className).toContain('motion-safe:animate-badgePop');
  });
});