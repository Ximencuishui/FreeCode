#!/usr/bin/env node
/**
 * 模拟 dsh CLI 的子进程夹具（供 DSHProcessManager 单元测试使用）。
 * 行为：
 *   - 正常：打印模拟输出后 exit 0
 *   - --crash：打印错误后 exit 1（模拟崩溃）
 *   - --hang：不退出（模拟长驻进程，用于测试 stop）
 */
const args = process.argv.slice(2);
const profileIndex = args.indexOf('--profile');
const profile = profileIndex >= 0 ? args[profileIndex + 1] : 'unknown';
const task = args[args.length - 1];

if (args.includes('--crash')) {
  console.error('[FakeDSH] simulated crash');
  process.exit(1);
}

if (args.includes('--hang')) {
  console.log('[FakeDSH] hanging...');
  setInterval(() => {}, 1000);
} else {
  setTimeout(() => {
    console.log(`[FakeDSH] profile=${profile} task=${task}`);
    console.log('模拟回复：你好');
    process.exit(0);
  }, 150);
}
