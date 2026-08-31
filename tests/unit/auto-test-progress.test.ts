import {
  inferAutoTestStep,
  formatDuration,
  estimateRemainingMs,
  progressPercent,
} from '../../src/renderer/components/Chat/autoTestProgress';

/**
 * 自动测试步骤推断单元测试（测试计划 4.2.x UT-AUTO-STEP-001~009）。
 *
 * 启发式边界（与 autoTestProgress.ts 的 STEP_BOUNDARIES 对齐）：
 * - 0 次工具调用 → -1（未开始）
 * - 1-2 次        → 0  inspect
 * - 3-5 次        → 1  write-tests
 * - 6-8 次        → 2  run-checks
 * - 9-11 次       → 3  audit-code
 * - ≥12 次        → 4  summary
 *
 * bash 出现：把当前步骤提前到 run-checks（步骤 2），不早于 write-tests。
 */
describe('inferAutoTestStep（步骤推断）', () => {
  it('UT-AUTO-STEP-001 0 次调用：返回 -1', () => {
    expect(inferAutoTestStep(0, false)).toBe(-1);
  });

  it('UT-AUTO-STEP-002 1 次调用（无 bash）：inspect（0）', () => {
    expect(inferAutoTestStep(1, false)).toBe(0);
  });

  it('UT-AUTO-STEP-003 2 次调用（无 bash）：inspect（0）', () => {
    expect(inferAutoTestStep(2, false)).toBe(0);
  });

  it('UT-AUTO-STEP-004 3 次调用（无 bash）：write-tests（1）', () => {
    expect(inferAutoTestStep(3, false)).toBe(1);
  });

  it('UT-AUTO-STEP-005 5 次调用（无 bash）：write-tests（1）', () => {
    expect(inferAutoTestStep(5, false)).toBe(1);
  });

  it('UT-AUTO-STEP-006 6 次调用（无 bash）：run-checks（2）', () => {
    expect(inferAutoTestStep(6, false)).toBe(2);
  });

  it('UT-AUTO-STEP-007 8 次调用（无 bash）：run-checks（2）', () => {
    expect(inferAutoTestStep(8, false)).toBe(2);
  });

  it('UT-AUTO-STEP-008 9 次调用（无 bash）：audit-code（3）', () => {
    expect(inferAutoTestStep(9, false)).toBe(3);
  });

  it('UT-AUTO-STEP-009 11 次调用（无 bash）：audit-code（3）', () => {
    expect(inferAutoTestStep(11, false)).toBe(3);
  });

  it('UT-AUTO-STEP-010 12 次调用（无 bash）：summary（4）', () => {
    expect(inferAutoTestStep(12, false)).toBe(4);
  });

  it('UT-AUTO-STEP-011 100 次调用（无 bash）：summary（4，封顶）', () => {
    expect(inferAutoTestStep(100, false)).toBe(4);
  });

  it('UT-AUTO-STEP-012 bash 提前推进：1 次调用 + bash → run-checks（2）', () => {
    expect(inferAutoTestStep(1, true)).toBe(2);
  });

  it('UT-AUTO-STEP-013 bash 推进不早于 write-tests：3 次调用 + bash → run-checks（2）', () => {
    expect(inferAutoTestStep(3, true)).toBe(2);
  });

  it('UT-AUTO-STEP-014 bash 推进不晚于原步骤：6 次 + bash → 仍是 run-checks', () => {
    expect(inferAutoTestStep(6, true)).toBe(2);
  });

  it('UT-AUTO-STEP-015 bash + 9 次调用：保持 audit-code（不会被 bash 提前覆盖）', () => {
    expect(inferAutoTestStep(9, true)).toBe(3);
  });

  it('UT-AUTO-STEP-016 负数调用次数：按 0 处理，返回 -1', () => {
    expect(inferAutoTestStep(-5, false)).toBe(-1);
  });
});

describe('formatDuration（毫秒 → "X 秒/分 秒"）', () => {
  it('0ms → "0 秒"', () => {
    expect(formatDuration(0)).toBe('0 秒');
  });

  it('999ms → "1 秒"（向上取整）', () => {
    expect(formatDuration(999)).toBe('1 秒');
  });

  it('23 秒（23_000ms）→ "23 秒"', () => {
    expect(formatDuration(23_000)).toBe('23 秒');
  });

  it('60 秒整（60_000ms）→ "1 分"（秒数为 0 不显示）', () => {
    expect(formatDuration(60_000)).toBe('1 分');
  });

  it('83 秒（83_000ms）→ "1 分 23 秒"', () => {
    expect(formatDuration(83_000)).toBe('1 分 23 秒');
  });

  it('负数 → "0 秒"（保护）', () => {
    expect(formatDuration(-100)).toBe('0 秒');
  });
});

describe('estimateRemainingMs（剩余时间估算）', () => {
  it('已完成测试：始终返回 0', () => {
    const startedAt = Date.now() - 60_000;
    expect(estimateRemainingMs(25_000, startedAt, Date.now(), true)).toBe(0);
  });

  it('未提供开始时间：返回期望总时长', () => {
    expect(estimateRemainingMs(25_000, null, Date.now())).toBe(25_000);
  });

  it('进行中：剩余 = 期望 - 已用', () => {
    const startedAt = 1_000;
    const now = 1_000 + 10_000;
    expect(estimateRemainingMs(25_000, startedAt, now)).toBe(15_000);
  });

  it('进行中超时：剩余 clamp 到 0（不为负）', () => {
    const startedAt = 1_000;
    const now = 1_000 + 60_000;
    expect(estimateRemainingMs(25_000, startedAt, now)).toBe(0);
  });
});

describe('progressPercent（步骤百分比）', () => {
  it('currentStep=-1（未开始）：0%', () => {
    expect(progressPercent(-1, 5)).toBe(0);
  });

  it('currentStep=0（首步进行中）：0%（步骤 -1 完成才计入）', () => {
    expect(progressPercent(0, 5)).toBe(0);
  });

  it('currentStep=2 / totalSteps=5：40%', () => {
    expect(progressPercent(2, 5)).toBe(40);
  });

  it('currentStep=4 / totalSteps=5：80%', () => {
    expect(progressPercent(4, 5)).toBe(80);
  });

  it('currentStep=5 / totalSteps=5：100%', () => {
    expect(progressPercent(5, 5)).toBe(100);
  });

  it('totalSteps=0：返回 0（保护）', () => {
    expect(progressPercent(2, 0)).toBe(0);
  });

  it('currentStep 越界上限：clamp 到 100%', () => {
    expect(progressPercent(99, 5)).toBe(100);
  });
});