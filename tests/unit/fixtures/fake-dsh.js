#!/usr/bin/env node
/**
 * 模拟 dsh CLI 的子进程夹具（DSH 单元测试 + E2E 离线测试共用）。
 * 行为（按任务特征匹配）：
 *   - 需求分析（含"产品需求分析师"）：输入含"个人使用+记录收支"时输出需求 JSON，否则提问
 *   - 版本分段（含"产品经理"）：输出版本计划 JSON（V1=记录收支，V2=分类统计）
 *   - 开发（含"全栈开发工程师"）：在 cwd 生成 index.html/style.css/app.js
 *   - 修改（含"开发工程师"）：改写 style.css
 *   - --crash：exit 1；--hang：不退出
 */
const args = process.argv.slice(2);
const profileIndex = args.indexOf('--profile');
const profile = profileIndex >= 0 ? args[profileIndex + 1] : 'unknown';
const task = args[args.length - 1] || '';

const path = require('node:path');
const fs = require('node:fs');

if (args.includes('--crash')) {
  console.error('[FakeDSH] simulated crash');
  process.exit(1);
}

if (args.includes('--hang')) {
  console.log('[FakeDSH] hanging...');
  setInterval(() => {}, 1000);
  return;
}

// 环境变量回显（用于验证 API Key 注入与脱敏）
if (task.includes('env-check')) {
  console.log(
    JSON.stringify({
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || null,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || null,
      OPENAI_MODEL: process.env.OPENAI_MODEL || null,
    }),
  );
  process.exit(0);
}

// 需求分析模式
if (task.includes('产品需求分析师')) {
  if (task.includes('个人使用') && task.includes('记录收支')) {
    console.log(
      JSON.stringify({
        project_name: '测试应用',
        goal: '个人收支记录工具',
        target_users: '个人使用',
        core_features: ['记录收支', '分类统计'],
        visual_style: '简洁',
        platform: 'web',
      }),
    );
  } else {
    console.log('好的，谁会用这个工具？\nA. 个人使用\nB. 家庭共用');
  }
  process.exit(0);
}

// 需求审查模式（确认需求前的最后一道关）
if (task.includes('需求审查专家')) {
  console.log('REVIEW_PASS');
  process.exit(0);
}

// 版本分段模式（写代码前的 MVP 切分）
if (task.includes('产品经理')) {
  console.log(
    JSON.stringify({
      versions: [
        { label: 'V1', description: '先能记账', features: ['记录收支'] },
        { label: 'V2', description: '看得更明白', features: ['分类统计'] },
      ],
    }),
  );
  process.exit(0);
}

// 开发模式（先生成代码）
if (task.includes('全栈开发工程师')) {
  const cwd = process.cwd();
  fs.writeFileSync(
    path.join(cwd, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1 class="title">测试应用</h1><p id="balance">余额：0</p></body></html>',
  );
  fs.writeFileSync(path.join(cwd, 'style.css'), 'h1 { color: #1A2B3C; }');
  fs.writeFileSync(path.join(cwd, 'app.js'), 'console.log("app ready");');
  console.log('已完成应用开发');
  process.exit(0);
}

// 修改模式
if (task.includes('开发工程师')) {
  const cwd = process.cwd();
  fs.writeFileSync(path.join(cwd, 'style.css'), 'h1 { color: #4A90D9; }');
  console.log('已将标题颜色调整为天蓝色 #4A90D9');
  process.exit(0);
}

// 通用回复
setTimeout(() => {
  // v0.1.09：把回显从 stdout 移到 stderr（parseDshOutput 不会再把它当成 AI 回复的一部分）。
  // 之前用 stdout 输出 `[FakeDSH] profile=... task=...` 让排查方便，但 parseDshOutput 改成
  // 保留完整多行后，这条回显会泄漏到聊天历史。stderr 不被 parseDshOutput 解析，保留排查价值。
  console.error(`[FakeDSH] profile=${profile} task=${task}`);
  console.log('模拟回复：你好');
  process.exit(0);
}, 150);
