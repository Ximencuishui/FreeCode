/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import AutoTestPlanCard from '../../src/renderer/components/Chat/AutoTestPlanCard';
import type { AutoTestPlanStep } from '../../src/shared/types/project';

const PLAN: AutoTestPlanStep[] = [
  { key: 'inspect', title: '检查文件齐全', description: '读取项目结构' },
  { key: 'write-tests', title: '编写测试用例', description: '针对核心功能编写' },
  { key: 'run-checks', title: '运行检查', description: '执行可运行检查' },
  { key: 'audit-code', title: '审计代码', description: '审查质量与边界' },
  { key: 'summary', title: '输出报告', description: '汇总结构化报告' },
];

/**
 * AutoTestPlanCard 渲染单元测试（UT-AUTO-CARD-001~005）：
 * - 默认渲染：5 步骤全显示、当前步骤带 data-status="active"
 * - 进行中：进度条宽度对应 currentStep + 1；剩余时间 + 友好提示
 * - 完成态：所有步骤 "done"、显示「本次总耗时」、不显示「预计还需」
 */
describe('AutoTestPlanCard（自动测试计划卡片）', () => {
  it('UT-AUTO-CARD-001 默认渲染：列出 5 个步骤，当前步骤标 active', () => {
    render(
      <AutoTestPlanCard
        plan={PLAN}
        currentStep={2}
        startedAt={Date.now() - 5_000}
        expectedDurationMs={25_000}
        dataTestid="fc-test-plan"
      />,
    );
    const root = screen.getByTestId('fc-test-plan');
    expect(root).toBeTruthy();
    const steps = root.querySelectorAll('[data-step]');
    expect(steps.length).toBe(5);
    // 当前步骤 run-checks 标 active，inspect/write-tests 标 done
    expect(steps[0].getAttribute('data-status')).toBe('done');
    expect(steps[1].getAttribute('data-status')).toBe('done');
    expect(steps[2].getAttribute('data-status')).toBe('active');
    expect(steps[3].getAttribute('data-status')).toBe('todo');
    expect(steps[4].getAttribute('data-status')).toBe('todo');
  });

  it('UT-AUTO-CARD-002 currentStep=-1（未开始）：全部 todo + 准备中文案', () => {
    render(
      <AutoTestPlanCard
        plan={PLAN}
        currentStep={-1}
        startedAt={null}
        expectedDurationMs={25_000}
        dataTestid="fc-test-plan-prepare"
      />,
    );
    const root = screen.getByTestId('fc-test-plan-prepare');
    expect(root.textContent).toContain('准备中');
    root.querySelectorAll('[data-step]').forEach((el) => {
      expect(el.getAttribute('data-status')).toBe('todo');
    });
  });

  it('UT-AUTO-CARD-003 进行中：进度条宽度与 currentStep 对应，显示剩余时间 + 友好提示', () => {
    const startedAt = Date.now() - 10_000;
    render(
      <AutoTestPlanCard
        plan={PLAN}
        currentStep={3}
        startedAt={startedAt}
        expectedDurationMs={25_000}
        dataTestid="fc-test-plan-running"
      />,
    );
    // 进度条对应 currentStep+1=4/5=80%
    const bar = screen.getByTestId('auto-test-plan-progress');
    expect((bar as HTMLElement).style.width).toBe('80%');
    // 已用时显示
    expect(screen.getByTestId('auto-test-elapsed').textContent).toContain('已用时');
    // 预计还需显示（未完成）
    const remaining = screen.queryByTestId('auto-test-remaining');
    expect(remaining?.textContent).toContain('预计还需');
    // 友好提示存在
    expect(screen.getByTestId('auto-test-friendly-tip').textContent).toContain('不用一直盯着');
  });

  it('UT-AUTO-CARD-004 完成态：所有步骤 done、不显示「预计还需」、显示「本次总耗时」', () => {
    render(
      <AutoTestPlanCard
        plan={PLAN}
        currentStep={4}
        startedAt={Date.now() - 23_000}
        expectedDurationMs={25_000}
        finished
        totalDurationMs={23_000}
        dataTestid="fc-test-plan-finished"
      />,
    );
    const root = screen.getByTestId('fc-test-plan-finished');
    // 5 步全部 done
    root.querySelectorAll('[data-step]').forEach((el) => {
      expect(el.getAttribute('data-status')).toBe('done');
    });
    // 不显示预计还需
    expect(screen.queryByTestId('auto-test-remaining')).toBeNull();
    // 不显示友好提示
    expect(screen.queryByTestId('auto-test-friendly-tip')).toBeNull();
    // 显示本次总耗时
    expect(screen.getByTestId('auto-test-total').textContent).toContain('本次总耗时');
    // 标题显示「已完成」
    expect(root.textContent).toContain('已完成');
  });

  it('UT-AUTO-CARD-005 latestProgress 透传：最近工具调用单行显示', () => {
    render(
      <AutoTestPlanCard
        plan={PLAN}
        currentStep={1}
        startedAt={Date.now() - 3_000}
        expectedDurationMs={25_000}
        latestProgress="🛠 运行 npm test"
        dataTestid="fc-test-plan-tool"
      />,
    );
    const tool = screen.getByTestId('auto-test-latest-tool');
    expect(tool.textContent).toContain('🛠 运行 npm test');
  });

  it('UT-AUTO-CARD-006 进行中不传 latestProgress：不渲染工具调用行', () => {
    render(
      <AutoTestPlanCard
        plan={PLAN}
        currentStep={1}
        startedAt={Date.now() - 3_000}
        expectedDurationMs={25_000}
        dataTestid="fc-test-plan-no-tool"
      />,
    );
    expect(screen.queryByTestId('auto-test-latest-tool')).toBeNull();
  });
});