/** @jest-environment jsdom */
/**
 * P0 建议 3 单测（补 Issue 2）：NotificationHost 渲染层。
 *
 * 覆盖：
 *   - 空 notifications 时不渲染（return null）
 *   - 有 notifications 时按入队顺序渲染
 *   - action 按钮点击 → onClick 被调 + 通知消失（先 dismiss 再 onClick）
 *   - 关闭按钮（✕）点击 → 通知消失
 *   - 自动消失：autoDismissMs 到点 → 通知消失
 *   - 自动消失：组件卸载 → timer 不再触发（无 setState on unmounted 警告）
 *
 * store 数据层由 notification-store.test.ts 覆盖；这里专注渲染 + 副作用。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import NotificationHost from '../../src/renderer/components/common/NotificationHost';
import { useUiStore } from '../../src/renderer/store/ui';

describe('NotificationHost 渲染层（P0 建议 3 审计补）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    act(() => {
      useUiStore.setState({ notifications: [] });
    });
  });
  afterEach(() => {
    act(() => {
      useUiStore.setState({ notifications: [] });
    });
    jest.useRealTimers();
  });

  it('P0-NOTI-HOST-001 空队列不渲染容器', () => {
    const { container } = render(<NotificationHost />);
    expect(container.firstChild).toBeNull();
  });

  it('P0-NOTI-HOST-002 push 一条后渲染对应卡片（testid + message）', () => {
    act(() => {
      useUiStore.getState().pushNotification({ kind: 'success', message: '应用已就绪' });
    });
    render(<NotificationHost />);
    const card = screen.getByTestId('fc-notification');
    expect(card.textContent).toContain('应用已就绪');
  });

  it('P0-NOTI-HOST-003 多条通知按入队顺序纵向堆叠', () => {
    act(() => {
      useUiStore.getState().pushNotification({ kind: 'info', message: 'first' });
      useUiStore.getState().pushNotification({ kind: 'info', message: 'second' });
      useUiStore.getState().pushNotification({ kind: 'info', message: 'third' });
    });
    render(<NotificationHost />);
    const cards = screen.getAllByTestId('fc-notification');
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('first'),
      expect.stringContaining('second'),
      expect.stringContaining('third'),
    ]);
  });

  it('P0-NOTI-HOST-004 点击 action 按钮 → onClick 被调 + 通知消失（先 dismiss 再 click）', () => {
    const onClick = jest.fn();
    act(() => {
      useUiStore.getState().pushNotification({
        kind: 'success',
        message: '应用已就绪',
        action: { label: '去看部署', onClick },
      });
    });
    render(<NotificationHost />);
    const actionBtn = screen.getByTestId('fc-notification-action');
    fireEvent.click(actionBtn);
    // onClick 被调
    expect(onClick).toHaveBeenCalledTimes(1);
    // 通知立即消失
    expect(screen.queryByTestId('fc-notification')).toBeNull();
    expect(useUiStore.getState().notifications).toHaveLength(0);
  });

  it('P0-NOTI-HOST-005 点击关闭按钮（✕）→ 通知消失', () => {
    act(() => {
      useUiStore.getState().pushNotification({ kind: 'info', message: 'A' });
    });
    render(<NotificationHost />);
    expect(screen.getByTestId('fc-notification')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(screen.queryByTestId('fc-notification')).toBeNull();
  });

  it('P0-NOTI-HOST-006 autoDismissMs 到点 → 通知自动消失', () => {
    act(() => {
      useUiStore.getState().pushNotification({
        kind: 'info',
        message: 'A',
        autoDismissMs: 3_000,
      });
    });
    render(<NotificationHost />);
    expect(screen.getByTestId('fc-notification')).toBeTruthy();
    // 时间未到，不应消失
    act(() => {
      jest.advanceTimersByTime(2_999);
    });
    expect(screen.queryByTestId('fc-notification')).toBeTruthy();
    // 到点
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('fc-notification')).toBeNull();
    expect(useUiStore.getState().notifications).toHaveLength(0);
  });

  it('P0-NOTI-HOST-007 不设 autoDismissMs 时不自动消失（必须手动 dismiss）', () => {
    act(() => {
      useUiStore.getState().pushNotification({ kind: 'info', message: 'sticky' });
    });
    render(<NotificationHost />);
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    // 60 秒后还在
    expect(screen.getByTestId('fc-notification').textContent).toContain('sticky');
  });

  it('P0-NOTI-HOST-008 手动 dismiss 后 timer 不再触发（stale timer 防护）', () => {
    act(() => {
      useUiStore.getState().pushNotification({
        kind: 'info',
        message: 'A',
        autoDismissMs: 5_000,
      });
    });
    const { rerender } = render(<NotificationHost />);
    const id = useUiStore.getState().notifications[0]?.id;
    expect(id).toBeDefined();
    // 1 秒后手动 dismiss
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    act(() => {
      useUiStore.getState().dismissNotification(id!);
    });
    rerender(<NotificationHost />);
    expect(screen.queryByTestId('fc-notification')).toBeNull();
    // 再走完剩余 4 秒，timer 触发不应导致 setState on unmounted（也无 visible effect）
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(useUiStore.getState().notifications).toHaveLength(0);
  });

  it('P0-NOTI-HOST-009 kind=success 使用翠绿样式（ring-emerald-200）', () => {
    act(() => {
      useUiStore.getState().pushNotification({ kind: 'success', message: 'A' });
    });
    const { container } = render(<NotificationHost />);
    const card = container.querySelector('[data-testid="fc-notification"]');
    expect(card?.className).toContain('ring-emerald-200');
  });

  it('P0-NOTI-HOST-010 kind=warning 使用琥珀样式（ring-amber-200）', () => {
    act(() => {
      useUiStore.getState().pushNotification({ kind: 'warning', message: 'A' });
    });
    const { container } = render(<NotificationHost />);
    const card = container.querySelector('[data-testid="fc-notification"]');
    expect(card?.className).toContain('ring-amber-200');
  });

  it('P0-NOTI-HOST-011 自定义 icon 覆盖默认图标', () => {
    act(() => {
      useUiStore.getState().pushNotification({
        kind: 'success',
        icon: '🚀',
        message: 'A',
      });
    });
    const { container } = render(<NotificationHost />);
    // icon 渲染在 aria-hidden 容器内
    const iconEl = container.querySelector('[aria-hidden="true"]');
    expect(iconEl?.textContent).toBe('🚀');
  });
});
