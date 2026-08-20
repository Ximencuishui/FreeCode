/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import Message from '../../src/renderer/components/Chat/Message';
import type { ChatMessageUI } from '../../src/renderer/store/chat';

describe('消息气泡（Message）', () => {
  const base: ChatMessageUI = {
    id: '1',
    role: 'assistant',
    content: '谁会用这个工具？\nA. 个人使用\nB. 家庭共用',
    timestamp: '2026-08-19T00:00:00.000Z',
  };

  it('渲染 assistant 消息文本', () => {
    render(<Message message={base} onSelectOption={() => undefined} />);
    expect(screen.getByText(/谁会用这个工具/)).toBeTruthy();
  });

  it('解析 A/B/C 选项并渲染按钮', () => {
    render(<Message message={base} onSelectOption={() => undefined} />);
    expect(screen.getByText('A. 个人使用')).toBeTruthy();
    expect(screen.getByText('B. 家庭共用')).toBeTruthy();
  });

  it('点击选项触发回调', () => {
    const onSelect = jest.fn();
    render(<Message message={base} onSelectOption={onSelect} />);
    fireEvent.click(screen.getByText('A. 个人使用'));
    expect(onSelect).toHaveBeenCalledWith({ key: 'A', label: '个人使用' });
  });

  it('用户消息右对齐（role=user）', () => {
    const userMsg: ChatMessageUI = { ...base, role: 'user', content: '我想做个记账工具' };
    render(<Message message={userMsg} onSelectOption={() => undefined} />);
    expect(screen.getByText('我想做个记账工具')).toBeTruthy();
  });

  it('系统消息居中显示', () => {
    const sysMsg: ChatMessageUI = { ...base, role: 'system', content: '系统提示' };
    render(<Message message={sysMsg} onSelectOption={() => undefined} />);
    expect(screen.getByText('系统提示')).toBeTruthy();
  });
});
