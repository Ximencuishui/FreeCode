/**
 * 自动测试相关 store 行为回归测试：
 * - 跨项目隔离：setProject 必须清掉上一项目的耗时摘要与估算时长
 * - 完成态同步清理：resetAutoTestPlan 必须同步清掉最近进度提示
 *   （覆盖审计 P2：原 message 分支里多余的 setTimeout 已被删除）
 */
import {
  useChatStore,
  DEFAULT_AUTO_TEST_PLAN,
  DEFAULT_AUTO_TEST_EXPECTED_MS,
} from '../../src/renderer/store/chat';
import type { AutoTestPlanSummary } from '../../src/shared/types/project';

const SUMMARY: AutoTestPlanSummary = {
  steps: DEFAULT_AUTO_TEST_PLAN,
  stepDurationsMs: [6_000, 6_000, 6_000, 6_000, 6_000],
  totalDurationMs: 30_000,
  finishedAt: '2026-08-31T10:00:00.000Z',
};

describe('chat store：自动测试状态', () => {
  beforeEach(() => {
    // 每个用例前清掉状态，避免上一个用例残留影响
    useChatStore.setState({
      autoTestLastSummary: null,
      autoTestExpectedDurationMs: DEFAULT_AUTO_TEST_EXPECTED_MS,
      autoTestLatestProgress: null,
      autoTestRunning: false,
      autoTestPlan: null,
      currentProjectId: null,
    });
  });

  it('UT-AUTO-STORE-001 setProject 清掉 autoTestLastSummary（避免跨项目残留）', () => {
    useChatStore.setState({ autoTestLastSummary: SUMMARY });
    expect(useChatStore.getState().autoTestLastSummary).toBe(SUMMARY);
    useChatStore.getState().setProject('proj-next');
    expect(useChatStore.getState().autoTestLastSummary).toBeNull();
  });

  it('UT-AUTO-STORE-002 setProject 重置 autoTestExpectedDurationMs 为默认值', () => {
    useChatStore.setState({ autoTestExpectedDurationMs: 42_000 });
    useChatStore.getState().setProject('proj-next');
    expect(useChatStore.getState().autoTestExpectedDurationMs).toBe(
      DEFAULT_AUTO_TEST_EXPECTED_MS,
    );
  });

  it('UT-AUTO-STORE-003 setProject 同时保留其他清理项不变', () => {
    useChatStore.setState({
      autoTestLastSummary: SUMMARY,
      autoTestExpectedDurationMs: 99_000,
      autoTestRunning: true,
      autoTestLatestProgress: '🛠 running',
      autoTestPlan: DEFAULT_AUTO_TEST_PLAN,
      autoTestCurrentStep: 2,
      autoTestStartedAt: 1_700_000_000_000,
      autoTestToolCount: 7,
      autoTestLatestToolLabel: '🛠 npm test',
      lastTestReport: {
        verdict: 'pass',
        issues: [],
        fullReport: '...',
      },
      devProgress: ['old'],
    });
    useChatStore.getState().setProject('proj-next');

    const s = useChatStore.getState();
    // 自动测试进行中字段被清
    expect(s.autoTestRunning).toBe(false);
    expect(s.autoTestLatestProgress).toBeNull();
    expect(s.autoTestPlan).toBeNull();
    expect(s.autoTestCurrentStep).toBe(-1);
    expect(s.autoTestStartedAt).toBeNull();
    expect(s.autoTestToolCount).toBe(0);
    expect(s.autoTestLatestToolLabel).toBeNull();
    expect(s.lastTestReport).toBeNull();
    expect(s.devProgress).toEqual([]);
    // 项目标识已更新
    expect(s.currentProjectId).toBe('proj-next');
  });

  it('UT-AUTO-STORE-004 resetAutoTestPlan 同步清掉 autoTestLatestProgress（覆盖审计 P2）', () => {
    useChatStore.setState({
      autoTestRunning: true,
      autoTestLatestProgress: '🛠 running',
      autoTestPlan: DEFAULT_AUTO_TEST_PLAN,
      autoTestCurrentStep: 2,
      autoTestStartedAt: Date.now(),
      autoTestToolCount: 5,
      autoTestLatestToolLabel: '🛠 npm test',
    });
    useChatStore.getState().resetAutoTestPlan();
    const s = useChatStore.getState();
    expect(s.autoTestLatestProgress).toBeNull();
    expect(s.autoTestRunning).toBe(false);
    expect(s.autoTestPlan).toBeNull();
    expect(s.autoTestCurrentStep).toBe(-1);
  });

  it('UT-AUTO-STORE-005 resetAutoTestPlan 不动 autoTestLastSummary / autoTestExpectedDurationMs', () => {
    useChatStore.setState({
      autoTestLastSummary: SUMMARY,
      autoTestExpectedDurationMs: 30_000,
      autoTestRunning: true,
      autoTestLatestProgress: '🛠 running',
    });
    useChatStore.getState().resetAutoTestPlan();
    const s = useChatStore.getState();
    // 完成态字段保留（用于下个测试周期学习）
    expect(s.autoTestLastSummary).toBe(SUMMARY);
    expect(s.autoTestExpectedDurationMs).toBe(30_000);
    // 进行中字段已清
    expect(s.autoTestRunning).toBe(false);
    expect(s.autoTestLatestProgress).toBeNull();
  });

  it('UT-INT-STORE-001 resetAutoTestPlan 同步清掉 interruptBanner（避免残留旧 reason）', () => {
    const banner = { reason: 'DSH 断开', retryAt: Date.now() + 5_000 };
    useChatStore.setState({
      autoTestRunning: true,
      interruptBanner: banner,
    });
    useChatStore.getState().resetAutoTestPlan();
    expect(useChatStore.getState().interruptBanner).toBeNull();
  });

  it('UT-INT-STORE-002 setProject 跨项目切换清掉 interruptBanner', () => {
    useChatStore.setState({
      interruptBanner: { reason: 'x', retryAt: Date.now() + 5_000 },
    });
    useChatStore.getState().setProject('proj-next');
    expect(useChatStore.getState().interruptBanner).toBeNull();
  });
});