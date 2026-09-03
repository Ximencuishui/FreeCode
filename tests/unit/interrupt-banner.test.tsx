/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import InterruptBanner from '../../src/renderer/components/Preview/InterruptBanner';

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

  // v0.1.02 P0-3：retryAt=null 表示已达重试上限
  // 编号 UT-INT-008/009：与 chat-events-signal.test.tsx 的 UT-INT-006/007 错开，
  // 后者测 hook 层的信号→banner 过渡，这里测组件层的 banner→UI 渲染。
  it('UT-INT-008 retryAt=null 时不显示倒计时，按钮文案改为「手动重试」', () => {
    render(
      <InterruptBanner
        banner={{ reason: 'DSH 已连续失败 3 次', retryAt: null }}
        onRetry={noop}
        onCancel={noop}
      />,
    );
    // 没有倒计时节点
    expect(screen.queryByTestId('fc-assistant-interrupt-countdown')).toBeNull();
    // 按钮文案变为「手动重试」
    expect(screen.getByTestId('fc-assistant-interrupt-retry').textContent).toBe('手动重试');
    // 标题补上「已达自动重试上限」
    expect(screen.getByTestId('fc-assistant-interrupt-banner').textContent).toContain(
      '已达自动重试上限',
    );
  });

  it('UT-INT-009 retryAt=null 时推进任意时长也不会自动 onRetry', () => {
    const onRetry = jest.fn();
    render(
      <InterruptBanner
        banner={{ reason: 'x', retryAt: null }}
        onRetry={onRetry}
        onCancel={noop}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(120_000);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });

  // v0.1.02 P3-AUDIT：倒计时到点应优先调用 onAutoRetry 而不是 onRetry，
  // 这样 P0-3 的 3 次失败上限才能在自动重试内循环里生效。
  it('UT-INT-010 倒计时到点优先调用 onAutoRetry（不调 onRetry）', () => {
    const onRetry = jest.fn();
    const onAutoRetry = jest.fn();
    render(
      <InterruptBanner
        banner={{ reason: 'x', retryAt: Date.now() + 5_000 }}
        onRetry={onRetry}
        onAutoRetry={onAutoRetry}
        onCancel={noop}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onAutoRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  // v0.1.02 P3-AUDIT：未传 onAutoRetry 时退回 onRetry（向后兼容）
  it('UT-INT-011 不传 onAutoRetry 时，倒计时退化为调用 onRetry', () => {
    const onRetry = jest.fn();
    render(
      <InterruptBanner
        banner={{ reason: 'x', retryAt: Date.now() + 5_000 }}
        onRetry={onRetry}
        onCancel={noop}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});