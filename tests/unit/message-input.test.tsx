/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import MessageInput from '../../src/renderer/components/Chat/MessageInput';

describe('输入区域（MessageInput）', () => {
  it('空输入时发送按钮禁用', () => {
    render(<MessageInput onSend={() => undefined} />);
    const btn = screen.getByText('发送') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('输入内容后发送按钮可用', () => {
    render(<MessageInput onSend={() => undefined} />);
    const input = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '你好' } });
    const btn = screen.getByText('发送') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('点击发送：回调收到内容并清空输入框', () => {
    const onSend = jest.fn();
    render(<MessageInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '我想做个工具' } });
    fireEvent.click(screen.getByText('发送'));
    expect(onSend).toHaveBeenCalledWith('我想做个工具');
    expect(input.value).toBe('');
  });

  it('Enter 键发送', () => {
    const onSend = jest.fn();
    render(<MessageInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '消息内容' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('消息内容');
  });

  it('处理中时禁用输入', () => {
    render(<MessageInput disabled onSend={() => undefined} />);
    const input = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
  });
});
