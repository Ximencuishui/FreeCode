import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tailwind 自定义 keyframes / animation 单测（测试计划 4.2.x UT-KF-001~002）。
 *
 * 目的：确保「测试完成态动效」相关的 fadeIn / badgePop 不会被误删，避免后续
 * 重构时静默丢失 PRD §1.3「正向反馈」所要求的视觉过渡。
 *
 * 实现说明：直接读 tailwind.config.js 文本做正则断言，避开 ts-jest 对 ESM
 * `export default` 的解析限制（tailwind.config.js 用 ESM，但 jest.config.cjs
 * 是 CommonJS 跑 ts-jest，无法直接 import）。
 */
describe('tailwind.config 自定义 keyframes / animation', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'tailwind.config.js'), 'utf8');

  it('UT-KF-001 keyframes 包含 fadeIn 与 badgePop', () => {
    expect(source).toMatch(/keyframes:\s*\{[\s\S]*?fadeIn:/);
    expect(source).toMatch(/keyframes:\s*\{[\s\S]*?badgePop:/);
    // 浅校验 fadeIn 的 from/to 与 badgePop 的关键帧 transform
    expect(source).toMatch(/fadeIn:[\s\S]*?from:\s*\{\s*opacity:\s*'0'/);
    expect(source).toMatch(/fadeIn:[\s\S]*?to:\s*\{\s*opacity:\s*'1'/);
    expect(source).toMatch(/badgePop:[\s\S]*?'0%':\s*\{\s*transform:\s*'scale\(0\.85\)'/);
    expect(source).toMatch(/badgePop:[\s\S]*?'100%':\s*\{\s*transform:\s*'scale\(1\)'/);
  });

  it('UT-KF-002 animation 暴露 fadeIn（200ms）与 badgePop（500ms）', () => {
    expect(source).toMatch(/animation:\s*\{[\s\S]*?fadeIn:\s*'fadeIn 200ms/);
    expect(source).toMatch(/animation:\s*\{[\s\S]*?badgePop:\s*'badgePop 500ms/);
  });
});