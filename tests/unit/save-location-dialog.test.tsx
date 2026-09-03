/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import SaveLocationDialog from '../../src/renderer/components/SaveLocationDialog';

/**
 * 保存位置弹窗单元测试：路径选择入口、跳过、确认、取消。
 *
 * v3.2.2 P2-19：组件迁到原生 <dialog> + showModal()。jsdom 默认不实现
 * HTMLDialogElement.showModal/close/open（无 ::backdrop 渲染），需在测试全局
 * mock 掉这三个原生方法，否则挂载即抛 TypeError。Mock 让 close() 派发 close 事件，
 * 与 Chromium 真实行为一致，便于断言 onCancel 桥接链路。
 */
describe('保存位置弹窗（SaveLocationDialog）', () => {
  const mockSelectLocation = jest.fn();
  const mockSettingsGet = jest.fn();

  beforeAll(() => {
    // jsdom 没有 HTMLDialogElement 的原生实现，手工补齐。
    // close() 派发 close 事件是关键，否则 useEffect 桥接不到 onCancel。
    if (typeof HTMLDialogElement !== 'undefined') {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        Object.defineProperty(this, 'open', { configurable: true, value: true });
      };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        Object.defineProperty(this, 'open', { configurable: true, value: false });
        this.dispatchEvent(new Event('close'));
      };
    }
  });

  function setup(overrides: { creating?: boolean; error?: string } = {}) {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(
      <SaveLocationDialog
        projectName="我的记账本"
        creating={overrides.creating ?? false}
        error={overrides.error}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    return { onConfirm, onCancel };
  }

  beforeEach(() => {
    mockSelectLocation.mockReset();
    mockSettingsGet.mockReset();
    mockSettingsGet.mockResolvedValue({ settings: { projectsPath: '~/.freecoder/Project' } });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        settings: { get: mockSettingsGet },
        project: { selectLocation: mockSelectLocation },
      },
    });
  });

  it('显示弹窗标题与默认保存位置', async () => {
    setup();
    // jsdom 不识别 <dialog> 元素的 implicit dialog role；改用 aria-label 定位。
    expect(screen.getByLabelText('选择项目保存位置')).toBeTruthy();
    expect(screen.getByText(/将项目保存在哪里/)).toBeTruthy();
    // 默认位置来自设置
    expect(await screen.findByText('~/.freecoder/Project')).toBeTruthy();
  });

  it('选择文件夹：展示所选路径，确认时以该位置创建', async () => {
    mockSelectLocation.mockResolvedValue({
      success: true,
      canceled: false,
      path: 'D:\\我的项目',
    });
    const { onConfirm } = setup();

    fireEvent.click(screen.getByText(/选择文件夹/));
    expect(await screen.findByText('D:\\我的项目')).toBeTruthy();

    fireEvent.click(screen.getByText('在此位置创建项目'));
    expect(onConfirm).toHaveBeenCalledWith('D:\\我的项目');
  });

  it('用户取消文件夹选择器：不改变所选路径，仍可跳过', async () => {
    mockSelectLocation.mockResolvedValue({ success: true, canceled: true });
    const { onConfirm } = setup();

    fireEvent.click(screen.getByText(/选择文件夹/));
    await screen.findByText('~/.freecoder/Project');

    // 未选择路径时，"在此位置创建项目"不可用
    expect((screen.getByText('在此位置创建项目') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('跳过，使用默认位置'));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('跳过：以默认位置创建（onConfirm 不带路径）', async () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByText('跳过，使用默认位置'));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('创建中：按钮禁用，且不可关闭', () => {
    const { onCancel } = setup({ creating: true });
    expect((screen.getByText('创建中…') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('关闭按钮与 ESC 触发取消', () => {
    const { onCancel } = setup();
    // ✕ 按钮：调 dialogRef.current.close() → mock close() 派发 close 事件 → handleClose → onCancel
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // ESC：浏览器原生 dialog 内部捕获 ESC → 触发 close 事件 → onCancel。
    // jsdom 无原生 ESC 拦截，测试中直接在 dialog 上派发 close 事件来模拟。
    const dialog = screen.getByLabelText('选择项目保存位置') as HTMLDialogElement;
    dialog.dispatchEvent(new Event('close'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('显示创建错误信息', () => {
    setup({ error: '目标位置不可写' });
    expect(screen.getByText('目标位置不可写')).toBeTruthy();
  });
});
