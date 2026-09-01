/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InterruptBanner } from '../../src/renderer/components/Preview/AssistantPanel';

/**
 * InterruptBanner 单测（UT-INT-001~005）。
 *
 * 目的：
 * - 验证渲染、点击行为、倒计时到点自动触发 onRetry
 * - 校验 stale timer 防护（banner 清掉后 timer 不再触发）
 * - 校验 5s 倒计时初始文案（与 ChatContainer 已有的 formatDuration 共用）
 */

const noop = (): void => undefined;

describe('InterruptBanner（测试被中断横幅）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 锁定当前时间，方便断言倒计时
    jest.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('UT-INT-001 渲染：显示 reason 文案 + 5 秒倒计时', () => {
    render(
      <InterruptBanner
        banner={{ reason: 'DSH 连接断开', retryAt: Date.now() + 5_000 }}
        onRetry={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('fc-assistant-interrupt-banner').textContent).toContain('DSH 连接断开');
    expect(screen.getByTestId('fc-assistant-interrupt-countdown').textContent).toContain('5 秒');
  });

  it('UT-INT-002 点击「立即重试」→ 调用 onRetry', () => {
    const onRetry = jest.fn();
    render(
      <InterruptBanner
        banner={{ reason: 'x', retryAt: Date.now() + 5_000 }}
        onRetry={onRetry}
        onCancel={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('fc-assistant-interrupt-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('UT-INT-003 点击「取消」→ 调用 onCancel，不触发 onRetry', () => {
    const onCancel = jest.fn();
    const onRetry = jest.fn();
    render(
      <InterruptBanner
        banner={{ reason: 'x', retryAt: Date.now() + 5_000 }}
        onRetry={onRetry}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('fc-assistant-interrupt-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('UT-INT-004 倒计时到点 → 自动调用 onRetry', () => {
    const onRetry = jest.fn();
    render(
      <InterruptBanner
        banner={{ reason: 'x', retryAt: Date.now() + 5_000 }}
        onRetry={onRetry}
        onCancel={noop}
      />,
    );
    // 推进 5s
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('UT-INT-005 banner 已清掉后组件 unmount，stale timer 不再触发', () => {
    const onRetry = jest.fn();
    const { rerender } = render(
      <InterruptBanner
        banner={{ reason: 'x', retryAt: Date.now() + 5_000 }}
        onRetry={onRetry}
        onCancel={noop}
      />,
    );
    // 模拟父组件条件渲染把 InterruptBanner 卸载：把渲染包到 fragment 里再 unmount
    rerender(<></>);
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });
});