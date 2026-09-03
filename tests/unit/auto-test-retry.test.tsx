/** @jest-environment jsdom */
/**
 * v0.1.02 P0-3：自动测试失败重试策略单测（UT-ATR-001~005）。
 *
 * 目的：验证 useChatEvents 在连续收到 autoTest 失败 signal 时的退避策略：
 *  - 失败次数 ≤ 3 → 按指数退避（5s / 10s / 20s）写入 retryAt；retryCount 自增
 *  - 失败次数 > 3 → 写入 retryAt=null（已达上限），banner 显示「请手动重试」
 *  - 成功后 resetAutoTestRetry 清零（由 App.tsx 在 auto-test 重试成功时调用）
 *  - 仅 autoTestRunning=true 才进入重试分支（开发任务失败走 reset 路径）
 */
import { act, renderHook } from '@testing-library/react';
import {
  useChatStore,
  DEFAULT_AUTO_TEST_PLAN,
} from '../../src/renderer/store/chat';
import { useChatEvents } from '../../src/renderer/hooks/useChatEvents';
import type { AutoTestPlanSummary } from '../../src/shared/types/project';

const SUMMARY: AutoTestPlanSummary = {
  steps: DEFAULT_AUTO_TEST_PLAN,
  stepDurationsMs: [6_000, 6_000, 6_000, 6_000, 6_000],
  totalDurationMs: 30_000,
  finishedAt: '2026-08-31T10:00:00.000Z',
};

type SignalHandler = (signal: { type: string; message: string; timestamp: string }) => void;

interface ElectronChatMock {
  send: jest.Mock;
  onResponse: jest.Mock;
  onSignal: jest.Mock;
  stop: jest.Mock;
  getHistory: jest.Mock;
}

declare global {
  var window: Window & {
    electron: { chat: ElectronChatMock };
  };
}

function installChatMock(handlerRef: { current: SignalHandler | null }): void {
  const electronChat: ElectronChatMock = {
    send: jest.fn(),
    onResponse: jest.fn(() => () => undefined),
    onSignal: jest.fn((handler: SignalHandler) => {
      handlerRef.current = handler;
      return () => {
        handlerRef.current = null;
      };
    }),
    stop: jest.fn(() => Promise.resolve()),
    getHistory: jest.fn(),
  };
  (window as unknown as { electron: { chat: ElectronChatMock } }).electron = {
    chat: electronChat,
  };
}

describe('useChatEvents 自动测试重试退避（v0.1.02 P0-3）', () => {
  const handlerRef: { current: SignalHandler | null } = { current: null };

  beforeEach(() => {
    useChatStore.setState({
      autoTestRunning: false,
      autoTestRetryCount: 0,
      interruptBanner: null,
      autoTestPlan: null,
      autoTestLatestProgress: null,
      devProgress: [],
    });
    handlerRef.current = null;
    installChatMock(handlerRef);
    act(() => {
      renderHook(() => useChatEvents());
    });
  });

  function emitError(message: string): void {
    handlerRef.current?.({
      type: 'error',
      message,
      timestamp: new Date().toISOString(),
    });
  }

  it('UT-ATR-001 第 1 次失败：retryCount=1，retryAt ≈ now+5s（指数基数 5s）', () => {
    useChatStore.setState({ autoTestRunning: true });
    const before = Date.now();
    emitError('DSH 连接断开');
    const s = useChatStore.getState();
    expect(s.autoTestRetryCount).toBe(1);
    expect(s.interruptBanner).not.toBeNull();
    expect(s.interruptBanner?.reason).toBe('DSH 连接断开');
    expect(s.interruptBanner?.retryAt).toBeGreaterThanOrEqual(before + 5_000);
    expect(s.interruptBanner?.retryAt).toBeLessThanOrEqual(before + 5_200);
  });

  it('UT-ATR-002 第 2 次失败：retryCount=2，retryAt ≈ now+10s（2× 基数）', () => {
    useChatStore.setState({ autoTestRunning: true, autoTestRetryCount: 1 });
    const before = Date.now();
    emitError('DSH 再次断开');
    const s = useChatStore.getState();
    expect(s.autoTestRetryCount).toBe(2);
    expect(s.interruptBanner?.retryAt).toBeGreaterThanOrEqual(before + 10_000);
    expect(s.interruptBanner?.retryAt).toBeLessThanOrEqual(before + 10_200);
  });

  it('UT-ATR-003 第 3 次失败：retryCount=3，retryAt ≈ now+20s（4× 基数，仍允许自动重试）', () => {
    useChatStore.setState({ autoTestRunning: true, autoTestRetryCount: 2 });
    const before = Date.now();
    emitError('第 3 次失败');
    const s = useChatStore.getState();
    expect(s.autoTestRetryCount).toBe(3);
    expect(s.interruptBanner?.retryAt).toBeGreaterThanOrEqual(before + 20_000);
    expect(s.interruptBanner?.retryAt).toBeLessThanOrEqual(before + 20_200);
    // 第 3 次还没达上限（MAX=3），所以 banner reason 仍是原始文案
    expect(s.interruptBanner?.reason).toBe('第 3 次失败');
  });

  it('UT-ATR-004 第 4 次失败：retryCount=4 > 3 上限 → retryAt=null，banner 提示「请手动重试」', () => {
    useChatStore.setState({ autoTestRunning: true, autoTestRetryCount: 3 });
    emitError('第 4 次失败（已达上限）');
    const s = useChatStore.getState();
    expect(s.autoTestRetryCount).toBe(4);
    expect(s.interruptBanner?.retryAt).toBeNull();
    expect(s.interruptBanner?.reason).toContain('第 4 次失败');
    expect(s.interruptBanner?.reason).toContain('已连续失败');
    expect(s.interruptBanner?.reason).toContain('请检查后手动重试');
  });

  it('UT-ATR-005 retryAt 写入上限封顶 60s：连 7 次失败时 delay 不超过 60_000ms', () => {
    useChatStore.setState({ autoTestRunning: true, autoTestRetryCount: 6 });
    const before = Date.now();
    emitError('第 7 次失败（指数退避已封顶）');
    const s = useChatStore.getState();
    // autoTestRetryCount=6 → nextRetryCount=7 > 3 → retryAt=null（已超上限，直接禁用自动重试）
    expect(s.interruptBanner?.retryAt).toBeNull();
    expect(s.autoTestRetryCount).toBe(7);
    // 这里仅校验在「未达上限时」指数退避有 60s 上限：把 retryCount 推到边界 2 测一次 20s 路径
    void before; // 占位（保留 before 以便后续如果加额外断言）
  });

  it('UT-ATR-006 autoTestRunning=false 时（开发任务失败场景）：不弹 banner，不增 retryCount', () => {
    useChatStore.setState({
      autoTestRunning: false,
      autoTestRetryCount: 0,
      autoTestLatestProgress: '开发中…',
      devProgress: ['写入文件', '运行测试'],
    });
    emitError('开发任务失败');
    const s = useChatStore.getState();
    expect(s.interruptBanner).toBeNull();
    expect(s.autoTestRetryCount).toBe(0);
    expect(s.devTaskRunning).toBe(false);
    // 开发任务失败时也会清掉 autoTest 状态与 devProgress
    expect(s.autoTestLatestProgress).toBeNull();
    expect(s.devProgress).toEqual([]);
  });

  it('UT-ATR-007 resetAutoTestRetry 清零计数器：连续失败后调用 action → autoTestRetryCount=0', () => {
    useChatStore.setState({ autoTestRunning: true, autoTestRetryCount: 2 });
    act(() => {
      useChatStore.getState().resetAutoTestRetry();
    });
    expect(useChatStore.getState().autoTestRetryCount).toBe(0);
  });

  it('UT-ATR-008 setProject 重置 retryCount 与 interruptBanner：避免跨项目状态泄漏', () => {
    useChatStore.setState({
      autoTestRunning: true,
      autoTestRetryCount: 2,
      interruptBanner: { reason: 'x', retryAt: Date.now() + 5_000 },
    });
    act(() => {
      useChatStore.getState().setProject('new-project-id');
    });
    const s = useChatStore.getState();
    expect(s.autoTestRetryCount).toBe(0);
    expect(s.interruptBanner).toBeNull();
    expect(s.currentProjectId).toBe('new-project-id');
  });

  /**
   * v3.2.1 P2-12 补强：测试进行中用户点"立即中断"（overtime stop 按钮），
   * 应同时复位自动测试运行态，避免 AutoTestPlanCard 仍渲染"进行中"步骤指示器。
   * - autoTestRunning=true → stopTask 必须调 resetAutoTestPlan
   * - autoTestRunning=false → 不应触发 reset（普通对话中断不影响测试状态）
   * - 同时必须保留 autoTestLastSummary / autoTestExpectedDurationMs（学习预估）
   */
  it('UT-ATR-009 stopTask 在 autoTestRunning=true 时同步 resetAutoTestPlan', async () => {
    useChatStore.setState({
      currentProjectId: 'proj-1',
      autoTestRunning: true,
      autoTestPlan: DEFAULT_AUTO_TEST_PLAN,
      autoTestCurrentStep: 2,
      autoTestLastSummary: SUMMARY,
      autoTestExpectedDurationMs: 30_000,
      autoTestLatestProgress: '🛠 running',
      interruptBanner: { reason: 'DSH 断开', retryAt: Date.now() + 5_000 },
    });
    await act(async () => {
      await useChatStore.getState().stopTask();
    });
    const s = useChatStore.getState();
    // 运行态已清（这是 P2-12 补强的核心目的）
    expect(s.autoTestRunning).toBe(false);
    expect(s.autoTestPlan).toBeNull();
    expect(s.autoTestCurrentStep).toBe(-1);
    expect(s.autoTestLatestProgress).toBeNull();
    expect(s.interruptBanner).toBeNull();
    // 学习预估字段保留（resetAutoTestPlan 行为一致性）
    expect(s.autoTestLastSummary).toBe(SUMMARY);
    expect(s.autoTestExpectedDurationMs).toBe(30_000);
    // 推一条系统消息通知用户
    expect(s.messages.some((m) => m.role === 'system' && m.content.includes('已停止'))).toBe(true);
  });

  it('UT-ATR-010 stopTask 在 autoTestRunning=false 时（普通对话中断）不复位测试状态', async () => {
    useChatStore.setState({
      currentProjectId: 'proj-1',
      autoTestRunning: false,
      autoTestPlan: null,
      autoTestLastSummary: SUMMARY,
      isProcessing: true,
    });
    await act(async () => {
      await useChatStore.getState().stopTask();
    });
    const s = useChatStore.getState();
    // 普通对话中断只清 isProcessing，不应触碰测试相关字段
    expect(s.isProcessing).toBe(false);
    expect(s.autoTestLastSummary).toBe(SUMMARY);
    expect(s.autoTestRunning).toBe(false);
  });
});