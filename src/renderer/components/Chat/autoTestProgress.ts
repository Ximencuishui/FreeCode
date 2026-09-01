/**
 * 自动测试进度推断：根据工具调用次数 + 类型启发式推进当前步骤。
 *
 * 设计动机：dsh prompt 中的 5 步测试任务对 LLM 是「自然语言指令」，LLM 不会主动输出
 * 显式的步骤标记；为此我们在渲染层用工具调用模式做轻量推断，避免对 prompt 做硬约束。
 *
 * 步骤与 buildAutoTestTask 对齐：
 *   0. inspect      检查应用文件是否齐全（多为 read）
 *   1. write-tests  编写可执行测试用例（多为 write/edit）
 *   2. run-checks   bash 实际运行可行的检查（出现 bash 即推进）
 *   3. audit-code   审计代码质量（read + write 混合）
 *   4. summary      汇总输出测试报告（无更多工具调用或 final message）
 */

const STEP_BOUNDARIES: ReadonlyArray<{ upTo: number; step: number }> = [
  { upTo: 0, step: -1 }, // 0 次工具调用：未开始
  { upTo: 2, step: 0 }, // 1-2 次：inspect（多为 read）
  { upTo: 5, step: 1 }, // 3-5 次：write-tests（多为 write/edit）
  { upTo: 8, step: 2 }, // 6-8 次：run-checks（含 bash）
  { upTo: 11, step: 3 }, // 9-11 次：audit-code
  { upTo: Number.POSITIVE_INFINITY, step: 4 }, // 12+：summary
];

const LAST_STEP = 4;

/**
 * 推断当前步骤。
 *
 * @param toolCount 累计工具调用次数（≥0）
 * @param hasBash 当前是否出现 bash/🛠 类型调用（用于把 run-checks 步骤提前）
 * @returns 步骤索引 -1..4
 */
export function inferAutoTestStep(toolCount: number, hasBash: boolean): number {
  if (toolCount <= 0) return -1;
  let step = -1;
  for (const boundary of STEP_BOUNDARIES) {
    if (toolCount <= boundary.upTo) {
      step = boundary.step;
      break;
    }
  }
  if (step < 0) step = LAST_STEP;

  // bash 出现意味着「正在/已经运行实际检查」；提前到 run-checks（不早于 write-tests）
  if (hasBash && step < 2) {
    step = 2;
  }
  return step;
}

/**
 * 渲染层时间格式化：毫秒 → "X 秒" / "X 分 Y 秒"。
 * 测试周期通常 < 60s，所以简化处理。
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`;
}

/**
 * 估算剩余时间（毫秒）。
 *
 * - 已完成测试：固定返回 0
 * - 未提供开始时间：返回期望总时长（首次渲染）
 * - 进行中：返回 `expected - elapsed`
 *   - 正数：仍在预期窗口内
 *   - 0：恰好到期
 *   - **负数：已超出预估**（测试实际比预估更久，调用方需渲染「已超出预估 X 秒」）
 *
 * 注意：本函数**不再 clamp 到 0**，避免出现「已用时 55 秒 / 预计还需 0 秒」的
 * 反直觉提示——会让用户误以为测试马上要结束，但 LLM 还在跑工具调用。
 */
export function estimateRemainingMs(
  expectedDurationMs: number,
  startedAt: number | null,
  now: number = Date.now(),
  finished = false,
): number {
  if (finished) return 0;
  if (!startedAt) return expectedDurationMs;
  const elapsed = now - startedAt;
  return expectedDurationMs - elapsed;
}

/** 是否处于「已超出预估」状态（进行中且剩余时间为负）。 */
export function isOvertime(
  expectedDurationMs: number,
  startedAt: number | null,
  now: number = Date.now(),
  finished = false,
): boolean {
  if (finished || !startedAt) return false;
  return expectedDurationMs - (now - startedAt) < 0;
}

/** 计划进度百分比（0-100）。 */
export function progressPercent(currentStep: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  const done = Math.max(0, currentStep); // currentStep=-1 时按 0% 计
  return Math.min(100, Math.round((done / totalSteps) * 100));
}