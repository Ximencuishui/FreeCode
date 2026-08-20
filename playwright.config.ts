import { defineConfig } from '@playwright/test';

/**
 * E2E 测试配置（测试计划 6.1）。
 * 使用 Playwright 的 Electron 支持驱动真实应用，不额外下载浏览器。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {},
});
