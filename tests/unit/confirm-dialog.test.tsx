/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import ConfirmDialog from '../../src/renderer/components/common/ConfirmDialog';

/**
 * v3.2.2 P1-15：ConfirmDialog 焦点恢复单测。
 *
 * 需求：弹窗打开时记录触发元素（trigger），关闭时把焦点还回去。
 * 避免键盘用户关闭弹窗后焦点掉回 <body>，得按 Tab 一路找回去。
 *
 * 关键不变量：
 * - 关闭按钮 / 遮罩 / ESC / 取消按钮触发关闭 → 都还原焦点到 trigger
 * - 弹窗内按钮点击导致 activeElement 变化 → 不影响关闭后还焦点到原 trigger
 */
describe('ConfirmDialog 焦点恢复（P1-15）', () => {
  /**
   * 用一个 wrapper 组件提供 trigger 按钮，方便断言「关闭后焦点是否回到 trigger」。
   * confirm/cancel 回调由 wrapper 拦截后切换 show 状态，模拟真实使用方式。
   */
  function Harness({ confirmLabel = '确认' }: { confirmLabel?: string }) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
          打开弹窗
        </button>
        <ConfirmDialog
          open={open}
          title="确认操作"
          description="这是描述"
          confirmLabel={confirmLabel}
          onCancel={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
        />
        <button type="button">外部按钮</button>
      </div>
    );
  }

  function getTrigger(): HTMLButtonElement {
    return screen.getByText('打开弹窗') as HTMLButtonElement;
  }

  it('打开 → 关闭后焦点回到 trigger（点击关闭按钮）', () => {
    render(<Harness />);
    const trigger = getTrigger();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    // 弹窗打开后默认聚焦到取消按钮
    expect(screen.getByText('取消')).toBeTruthy();

    // 点击关闭按钮（实际上是关闭弹窗的 cancel 路径）
    fireEvent.click(screen.getByText('取消'));
    // 焦点回到 trigger
    expect(document.activeElement).toBe(trigger);
  });

  it('ESC 关闭后焦点回到 trigger', () => {
    render(<Harness />);
    const trigger = getTrigger();
    trigger.focus();
    fireEvent.click(trigger);

    // 焦点先到取消按钮
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('遮罩点击关闭后焦点回到 trigger', () => {
    render(<Harness />);
    const trigger = getTrigger();
    trigger.focus();
    fireEvent.click(trigger);

    // 点击遮罩（role=alertdialog 的 div，e.target === currentTarget 触发 onCancel）
    const dialog = screen.getByRole('alertdialog');
    fireEvent.mouseDown(dialog);
    expect(document.activeElement).toBe(trigger);
  });

  it('弹窗内按钮 focus 变化不影响还焦点位置', () => {
    render(<Harness confirmLabel="确认删除" />);
    const trigger = getTrigger();
    trigger.focus();
    fireEvent.click(trigger);

    // 用户在弹窗内切到确认按钮（不会触发 triggerRef 覆盖）
    fireEvent.click(screen.getByText('确认删除'));
    // 焦点回到 trigger（不是确认按钮）
    expect(document.activeElement).toBe(trigger);
  });

  it('再次打开仍正确记录 trigger', () => {
    render(<Harness />);
    const trigger = getTrigger();
    trigger.focus();

    // 第一次开关
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('取消'));
    expect(document.activeElement).toBe(trigger);

    // 第二次开关
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('取消'));
    expect(document.activeElement).toBe(trigger);
  });
});