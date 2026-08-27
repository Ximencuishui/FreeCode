#!/usr/bin/env node
/**
 * 打包版本号自动递增脚本（每次 pnpm package 时自动执行）。
 *
 * 规则：
 * - 每次打包将版本号尾数 +1；
 * - 尾数固定为两位数（01、02 … 99），序列从 0.1.01 开始：
 *     0.1.01 → 0.1.02 → … → 0.1.99 → 0.2.01（尾数超过 99 时进位到次版本，保持两位数）；
 * - 直接改写 package.json 的 version，应用内显示（app.getVersion()）与安装包文件名
 *   （electron-builder 的 ${version} 模板）均使用该版本号，保证一致。
 *
 * 用法：node scripts/bump-version.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
// 兼容可能存在的 UTF-8 BOM（Node 的 JSON.parse 不接受 BOM 前缀）
const raw = readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, '');
const pkg = JSON.parse(raw);

const oldVersion = pkg.version;
const [major, minor, patch] = String(oldVersion ?? '')
  .split('.')
  .map((part) => parseInt(part, 10));

if (![major, minor, patch].every(Number.isInteger)) {
  console.error(`[bump-version] 无法解析当前版本号 "${oldVersion}"，请检查 package.json 的 version 字段。`);
  process.exit(1);
}

let nextMinor = minor;
let nextPatch = patch + 1;
if (nextPatch > 99) {
  nextMinor += 1;
  nextPatch = 1;
}

const nextVersion = `${major}.${nextMinor}.${String(nextPatch).padStart(2, '0')}`;
pkg.version = nextVersion;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`[bump-version] ${oldVersion} → ${nextVersion}`);
