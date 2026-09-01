/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { useChatStore } from '../../src/renderer/store/chat';
import { useChatEvents } from '../../src/renderer/hooks/useChatEvents';

/**
 * useChatEvents 信号分支单测（UT-INT-006~007）。
 *
 * 目的：验证 signal.type='error' 在不同 autoTestRunning 状态下走不同分支：
 * - autoTestRunning=true → 弹出 interruptBanner（带 5s 重试时间戳）
 * - autoTestRunning=false → 不弹 banner，走 reset 路径
 */

type SignalHandler = (signal: { type: string; message: string; timestamp: string }) => void;

interface ElectronChatMock {
  send: jest.Mock;
  onResponse: jest.Mock;
  onSignal: jest.Mock;
  stop: jest.Mock;
  getHistory: jest.Mock;
}

declare global {
  // eslint-disable-next-line no-var
  var window: Window & {
    electron: { chat: ElectronChatMock };
  };
}

function installChatMock(handlerRef: { current: SignalHandler | null }): void {
  const electronChat: ElectronChatMock = {
    send: jest.fn(),
    onResponse: jest.fn(() => () => undefined),
    onSignal: jest.fn((handler: SignalHandler) => {
      // 同步保存，供测试触发
      handlerRef.current = handler;
      return () => {
        handlerRef.current = null;
      };
    }),
    stop: jest.fn(),
    getHistory: jest.fn(),
  };
  (window as unknown as { electron: { chat: ElectronChatMock } }).electron = {
    chat: electronChat,
  };
}

describe('useChatEvents signal.type=error 时的横幅分支', () => {
  const handlerRef: { current: SignalHandler | null } = { current: null };

  beforeEach(() => {
    useChatStore.setState({
      autoTestRunning: false,
      interruptBanner: null,
      autoTestPlan: null,
      autoTestLatestProgress: null,
    });
    handlerRef.current = null;
    installChatMock(handlerRef);
    // 触发 hook 挂载并等 effect 注册 handler
    act(() => {
      renderHook(() => useChatEvents());
    });
  });

  it('UT-INT-006 autoTestRunning=true 时弹 interruptBanner，含 5s 后的 retryAt', () => {
    useChatStore.setState({ autoTestRunning: true });
    const before = Date.now();
    handlerRef.current?.({
      type: 'error',
      message: 'DSH 连接超时',
      timestamp: new Date().toISOString(),
    });
    const banner = useChatStore.getState().interruptBanner;
    expect(banner).not.toBeNull();
    expect(banner?.reason).toBe('DSH 连接超时');
    expect(banner?.retryAt).toBeGreaterThanOrEqual(before + 5_000);
    expect(banner?.retryAt).toBeLessThanOrEqual(before + 5_200);
  });

  it('UT-INT-007 autoTestRunning=false 时（开发任务失败场景）不弹 banner，只 reset', () => {
    useChatStore.setState({
      autoTestRunning: false,
      autoTestLatestProgress: 'some progress',
    });
    handlerRef.current?.({
      type: 'error',
      message: 'dev task failed',
      timestamp: new Date().toISOString(),
    });
    expect(useChatStore.getState().interruptBanner).toBeNull();
    expect(useChatStore.getState().autoTestRunning).toBe(false);
    expect(useChatStore.getState().autoTestLatestProgress).toBeNull();
  });
});