/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  SuggestRetestCard,
  shouldShowSuggestRetest,
} from '../../src/renderer/components/Preview/AssistantPanel';
import type { StructuredTestReport } from '../../src/shared/types/project';

/**
 * SuggestRetestCard 单测（UT-SR-001~007）。
 *
 * 覆盖范围：
 * - shouldShowSuggestRetest 纯函数（UT-SR-001~004）：条件分支全打透
 * - SuggestRetestCard 组件（UT-SR-005~007）：按钮行为 + 30s 窗口自动过期
 */

const noop = (): void => undefined;

const WARN_REPORT: StructuredTestReport = {
  verdict: 'warn',
  issues: [
    { title: 'a', severity: 'medium', detail: 'd', file: 'f' },
  ],
  fullReport: '...',
};

const PASS_REPORT: StructuredTestReport = {
  verdict: 'pass',
  issues: [],
  fullReport: '...',
};

describe('shouldShowSuggestRetest（修复完成衔接渲染条件）', () => {
  const baseArgs = {
    autoTestRunning: false,
    lastTestReport: WARN_REPORT,
    lastTestFixAt: Date.now() - 5_000, // 5 秒前
    isProcessing: false,
  };

  it('UT-SR-001 verdict=pass 时不渲染（即使有 lastTestFixAt）', () => {
    expect(
      shouldShowSuggestRetest({
        ...baseArgs,
        lastTestReport: PASS_REPORT,
      }),
    ).toBe(false);
  });

  it('UT-SR-002 verdict=warn + 5 秒前 fix → 渲染', () => {
    expect(shouldShowSuggestRetest(baseArgs)).toBe(true);
  });

  it('UT-SR-003 verdict=warn + 31 秒前 fix → 不渲染（30s 窗口过期）', () => {
    expect(
      shouldShowSuggestRetest({
        ...baseArgs,
        lastTestFixAt: Date.now() - 31_000,
      }),
    ).toBe(false);
  });

  it('UT-SR-004 isProcessing=true → 不渲染（AI 还在改）', () => {
    expect(
      shouldShowSuggestRetest({
        ...baseArgs,
        isProcessing: true,
      }),
    ).toBe(false);
  });

  // 额外覆盖（不属于 plan 的 7 个 UT，但顺手补齐保证鲁棒性）
  it('边界：autoTestRunning=true → 不渲染', () => {
    expect(
      shouldShowSuggestRetest({
        ...baseArgs,
        autoTestRunning: true,
      }),
    ).toBe(false);
  });

  it('边界：lastTestFixAt=null → 不渲染', () => {
    expect(
      shouldShowSuggestRetest({
        ...baseArgs,
        lastTestFixAt: null,
      }),
    ).toBe(false);
  });

  it('边界：lastTestReport=null → 不渲染', () => {
    expect(
      shouldShowSuggestRetest({
        ...baseArgs,
        lastTestReport: null,
      }),
    ).toBe(false);
  });

  it('边界：lastTestFixAt=0 → 不渲染（0 是哨兵值，表示无修复）', () => {
    expect(
      shouldShowSuggestRetest({
        ...baseArgs,
        lastTestFixAt: 0,
      }),
    ).toBe(false);
  });
});

describe('SuggestRetestCard（建议再测一次提示卡）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('UT-SR-005 点击「立即再测」→ 调用 onAction(auto-test)', () => {
    const onAction = jest.fn();
    render(
      <SuggestRetestCard
        lastTestFixAt={Date.now() - 5_000}
        onAction={onAction}
        onClear={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('fc-assistant-suggest-retest-now'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('auto-test');
  });

  it('UT-SR-006 点击「稍后」→ 调用 onClear', () => {
    const onClear = jest.fn();
    render(
      <SuggestRetestCard
        lastTestFixAt={Date.now() - 5_000}
        onAction={noop}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByTestId('fc-assistant-suggest-retest-later'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('UT-SR-007 1s 定时器：30s 窗口到期时主动调 onClear', () => {
    const onClear = jest.fn();
    render(
      <SuggestRetestCard
        lastTestFixAt={Date.now()} // 现在（0 ms 前）
        onAction={noop}
        onClear={onClear}
      />,
    );
    // 推进 29s：未过期，onClear 不该被调用
    act(() => {
      jest.advanceTimersByTime(29_000);
    });
    expect(onClear).not.toHaveBeenCalled();
    // 再推进到 30s：触发 onClear（生产里父组件收到回调后会清掉 lastTestFixAt → unmount，
    // 但本单测直接渲染组件，所以 onClear 可能被 1s 定时器多次调用，断言至少 1 次即可）
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(onClear).toHaveBeenCalled();
  });

  it('渲染：标题文案 + 「立即再测」「稍后」按钮 + 倒计时', () => {
    render(
      <SuggestRetestCard
        lastTestFixAt={Date.now() - 5_000}
        onAction={noop}
        onClear={noop}
      />,
    );
    expect(screen.getByTestId('fc-assistant-suggest-retest').textContent).toContain(
      '代码已修复完毕',
    );
    expect(screen.getByTestId('fc-assistant-suggest-retest-now').textContent).toContain(
      '立即再测',
    );
    expect(screen.getByTestId('fc-assistant-suggest-retest-later').textContent).toContain(
      '稍后',
    );
    expect(screen.getByTestId('fc-assistant-suggest-retest').textContent).toMatch(
      /后自动隐藏/,
    );
  });
});