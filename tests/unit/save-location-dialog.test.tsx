/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import SaveLocationDialog from '../../src/renderer/components/SaveLocationDialog';

/**
 * 保存位置弹窗单元测试：路径选择入口、跳过、确认、取消。
 */
describe('保存位置弹窗（SaveLocationDialog）', () => {
  const mockSelectLocation = jest.fn();
  const mockSettingsGet = jest.fn();

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
    expect(screen.getByRole('dialog')).toBeTruthy();
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

  it('创建中：按钮禁用，且不可关闭', async () => {
    const { onCancel } = setup({ creating: true });
    expect((screen.getByText('创建中…') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('关闭按钮与 ESC 触发取消', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('显示创建错误信息', () => {
    setup({ error: '目标位置不可写' });
    expect(screen.getByText('目标位置不可写')).toBeTruthy();
  });
});
