#!/usr/bin/env node
/**
 * 打包前准备：把 DeepSeek Harness（dsh）CLI 运行时 + Node 运行时复制到 resources/，
 * 供 electron-builder 以 extraResources 打进安装包（应用内置 dsh 与 Node，无需用户安装）。
 *
 * 用法：
 *   node scripts/bundle-dsh.mjs
 * 可选环境变量：
 *   DSH_PACKAGE_ROOT  dsh 安装根目录（默认 G:\DSH，即 @deepseek-ai/dsh 的 npm 安装点）
 *   NODE_EXE_PATH     要内置的 node.exe 路径（默认 D:\nodejs\node.exe）
 *
 * 说明：
 * - 复制 sourceRoot/node_modules 的完整目录树（dsh 全家桶运行时）。dsh 部分包存在
 *   未在 package.json 声明却直接 import 的依赖（如 dsh-app-boot → cordis-plugin-group），
 *   静态依赖闭包无法覆盖，完整复制可与本地已验证可用的安装保持一致。
 * - 复制 node.exe 到 resources/node/。headless 捆绑包会在启动时 import node-pty（原生
 *   模块，按 Node ABI 预编译），因此必须用真实 Node 运行，不能走 Electron 的
 *   ELECTRON_RUN_AS_NODE（ABI 不兼容）。
 * - 复制完成后用内置 node.exe 对内置 CLI 做一次 --help 冒烟启动，确保模块解析无误。
 *
 * 产物布局（镜像源 node_modules，保证模块解析一致）：
 *   resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
 *   resources/dsh/node_modules/...（完整运行时）
 *   resources/node/node.exe
 *
 * 运行方式：主进程以 [<resources>/node/node.exe, <resources>/dsh/.../bin.js] 启动
 * （见 src/main/dsh/service.ts resolveDshLaunch）。
 */
import { cp, access, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourceRoot = process.env.DSH_PACKAGE_ROOT || 'G:\\DSH';
const sourceNodeModules = path.join(sourceRoot, 'node_modules');
const targetRoot = path.join(repoRoot, 'resources', 'dsh');
const targetNodeModules = path.join(targetRoot, 'node_modules');

const nodeExeSource = process.env.NODE_EXE_PATH || 'D:\\nodejs\\node.exe';
const targetNodeDir = path.join(repoRoot, 'resources', 'node');
const targetNodeExe = path.join(targetNodeDir, 'node.exe');

const DSH_PKG = '@deepseek-ai/dsh';
const DSH_BIN_REL = path.join('@deepseek-ai', 'dsh', 'lib', 'bin.js');

/** Node.js 许可证（MIT，随包分发以满足合规要求） */
const NODE_LICENSE = `Node.js is licensed under the MIT License.

Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

See https://github.com/nodejs/node/blob/main/LICENSE for third-party notices.
`;

/** 顶层复制时排除的杂项（非运行时包） */
const SKIP_TOP = new Set(['.bin', '.package-lock.json', '.cache', '.pnpm']);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** 目录总大小（字节） */
async function dirSize(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      total += (await stat(full)).size;
    }
  }
  return total;
}

async function main() {
  if (!(await exists(path.join(sourceNodeModules, DSH_PKG, 'package.json')))) {
    console.error(
      `[bundle-dsh] 未找到 ${DSH_PKG}：请先在 ${sourceRoot} 执行 npm install（安装 @deepseek-ai/dsh），` +
        `或通过 DSH_PACKAGE_ROOT 指定 dsh 安装目录。`,
    );
    process.exit(1);
  }

  // 1. 清理目标目录（重建 .gitkeep 占位，避免误删后 git 出现 D 状态）
  await rm(targetRoot, { recursive: true, force: true });
  await rm(targetNodeDir, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  await mkdir(targetNodeDir, { recursive: true });
  await writeFile(path.join(targetRoot, '.gitkeep'), '', 'utf-8');
  await writeFile(path.join(targetNodeDir, '.gitkeep'), '', 'utf-8');

  // 2. 复制完整 node_modules 树
  await mkdir(targetNodeModules, { recursive: true });

  let copied = 0;
  const entries = await readdir(sourceNodeModules, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_TOP.has(entry.name)) continue;
    const src = path.join(sourceNodeModules, entry.name);
    const dest = path.join(targetNodeModules, entry.name);
    if (entry.isDirectory()) {
      await cp(src, dest, { recursive: true });
      copied += 1;
    } else {
      await cp(src, dest);
    }
  }

  // 3. 校验入口存在
  const binTarget = path.join(targetNodeModules, DSH_BIN_REL);
  if (!(await exists(binTarget))) {
    console.error(`[bundle-dsh] 失败：复制后缺少入口 ${binTarget}`);
    process.exit(1);
  }

  // 4. 复制内置 Node 运行时（headless 捆绑包启动时 import node-pty 原生模块，
  //    需真实 Node；Electron 的 ELECTRON_RUN_AS_NODE 存在 ABI 不兼容风险）
  if (!(await exists(nodeExeSource))) {
    console.error(
      `[bundle-dsh] 失败：未找到 node.exe（${nodeExeSource}），请通过 NODE_EXE_PATH 指定。`,
    );
    process.exit(1);
  }
  await cp(nodeExeSource, targetNodeExe);
  await writeFile(path.join(targetNodeDir, 'LICENSE'), NODE_LICENSE, 'utf-8');

  // 5. 冒烟启动：用内置 node.exe 直接运行 --help，验证模块解析（不依赖 API Key）
  const smokeHome = path.join(
    os.tmpdir(),
    `dsh-bundle-smoke-${crypto.randomBytes(4).toString('hex')}`,
  );
  const boot = spawnSync(targetNodeExe, [binTarget, '--help'], {
    stdio: 'inherit',
    env: { ...process.env, DSH_HOME: smokeHome },
    timeout: 60_000,
  });
  if (boot.status !== 0) {
    console.error(
      `[bundle-dsh] 失败：内置 dsh CLI 冒烟启动未通过（exit=${boot.status ?? boot.error?.message ?? 'unknown'}）`,
    );
    process.exit(1);
  }

  const totalBytes = (await dirSize(targetRoot)) + (await stat(targetNodeExe)).size;
  console.log(
    `[bundle-dsh] 完成：共复制 ${copied} 个顶层包 + node.exe，体积 ${(totalBytes / 1024 / 1024).toFixed(1)} MB` +
      `\n  dsh 运行时：${targetRoot}` +
      `\n  入口：${binTarget}` +
      `\n  node 运行时：${targetNodeExe}` +
      `\n  冒烟启动：通过（内置 node --help）`,
  );
}

main().catch((err) => {
  console.error('[bundle-dsh] 执行失败：', err);
  process.exit(1);
});
