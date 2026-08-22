import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * E2E-001 核心旅程（测试计划 6.2.1）：
 * 创建项目 → 对话 → 需求卡片 → 确认 → 版本分段 → 确认计划 → 开发 → 预览。
 * 使用 fake-dsh 替代真实 DSH，离线可测（测试计划 3.3 测试隔离）。
 */

let app: ElectronApplication;
let page: Page;
let dataDir: string;

test.beforeAll(async () => {
  // 隔离数据目录与 DSH 命令（fake-dsh 模拟：需求 JSON / 生成代码 / 修改样式）
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-e2e-'));
  process.env.FREECODER_HOME = dataDir;
  process.env.FREECODER_DSH_COMMAND = JSON.stringify([
    process.execPath,
    path.join(__dirname, '..', 'tests', 'unit', 'fixtures', 'fake-dsh.js'),
  ]);
  console.log('[e2e] FREECODER_DSH_COMMAND =', process.env.FREECODER_DSH_COMMAND);

  app = await electron.launch({
    args: ['dist/main/index.js'],
    env: { ...process.env },
  });
  page = await app.firstWindow();
  // 调试日志：主进程 stdout/stderr + 渲染进程 console
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main-out]', d.toString().trim()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main-err]', d.toString().trim()));
  page.on('console', (msg) => console.log('[renderer]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
});

test.afterAll(async () => {
  await app.close();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test('E2E-001 完整用户旅程：从想法到预览', async () => {
  // 0. 首次启动：自动弹出大模型 API 配置引导（与 DeepSeek Harness 一致）→ 填入并保存
  await expect(page.locator('text=欢迎使用 FreeCoder')).toBeVisible();
  await page.fill('input[type="password"]', 'sk-test1234567890abcdef');
  await page.click('button:has-text("保存并开始")');
  await expect(page.locator('input[type="password"]')).toBeHidden({ timeout: 10_000 });

  // 1. 创建项目（点击"开始对话"后弹出保存位置弹窗，跳过使用默认位置）
  await expect(page.locator('input[placeholder="例如：我的记账本"]')).toBeVisible();
  await page.fill('input[placeholder="例如：我的记账本"]', '测试记账本');
  await page.click('button:has-text("开始对话")');
  await page.click('button:has-text("跳过，使用默认位置")');
  await expect(page.locator('textarea')).toBeVisible();

  // 2. 发送需求消息 → fake-dsh 返回需求 JSON
  await page.fill('textarea', '我想做个记账工具，个人使用，记录收支');
  await page.press('textarea', 'Enter');

  // 3. AI 回复 + 需求卡片出现（需求文本同时出现在气泡与卡片，用确认按钮作为收敛信号）
  await expect(page.locator('button:has-text("确认需求，规划版本")')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('text=个人收支记录工具').first()).toBeVisible();

  // 4. 确认需求 → 进入版本分段阶段（planned），后台生成版本计划
  await page.click('button:has-text("确认需求，规划版本")');
  // 版本计划卡片出现（fake-dsh 返回 V1=记录收支 / V2=分类统计），确认按钮可用
  const planCard = page.getByTestId('version-plan-card');
  await expect(planCard).toBeVisible({ timeout: 30_000 });
  await expect(planCard.getByText('记录收支', { exact: true })).toBeVisible();

  // 5. 确认版本计划 → 开发（fake-dsh 生成代码）→ 完成信号
  await page.click('button:has-text("确认计划，开始开发 V1")');
  await expect(page.locator('text=开发完成！您的应用已就绪')).toBeVisible({ timeout: 30_000 });

  // 6. 切换到预览视图（title 精确匹配侧栏按钮，避免与步骤条「预览调整」歧义）
  await page.click('button[title="预览"]');
  await expect(page.locator('webview')).toBeVisible({ timeout: 15_000 });

  // 7. 预览内容加载（webview 指向本地预览服务器）
  const webview = page.locator('webview');
  const src = await webview.getAttribute('src');
  expect(src).toMatch(/^http:\/\/localhost:\d+$/);
});

test('E2E-002 元素检查链路：点击元素返回友好描述', async () => {
  // 进入预览视图（E2E-001 已开发完成）
  await page.click('button[title="预览"]');
  const webview = page.locator('webview');
  await expect(webview).toBeVisible({ timeout: 15_000 });

  // Playwright 无法穿透 webview guest DOM，直接验证 IPC 全链路
  // （真实点击路径：webview preload 捕获 → sendToHost → preview:element）
  const result = await page.evaluate(async () => {
    const r = await window.electron.preview.selectElement({
      element: {
        tag: 'h1',
        selector: 'h1.title',
        content: '测试应用',
        styles: { color: '#1A2B3C', fontSize: '32px' },
        position: { x: 0, y: 0, width: 100, height: 30 },
      },
    });
    return r;
  });

  expect(result.success).toBe(true);
  expect(result.elementInfo?.name).toBe('主标题');
  expect(result.elementInfo?.description).toContain('您正在查看主标题');
  expect(result.elementInfo?.description).toContain('#1A2B3C');
});
