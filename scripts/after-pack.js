// scripts/after-pack.js
// electron-builder 在 extraResources 复制阶段会把"from 子目录名恰好是
// `node_modules`"的情况整目录静默跳过（app-builder-lib/out/util/filter.js:43-44
// 的"filter the root node_modules, but not a subnode_modules"判断不区分上下文），
// 而 dsh 运行时恰好就是 `resources/dsh/node_modules/...`，结果：所有 0.1.0~0.1.6
// 安装包都漏装 dsh。
//
// 这个 hook 绕过该限制——在 win-unpacked 构建完成、portable/NSIS 打包前手 cp
// 把本地 resources/dsh 整个复制到 appOutDir/resources/dsh，后续打包步骤会自然
// 把它带进安装包。
//
// AfterPackContext = PackContext（app-builder-lib/out/configuration.d.ts）：
//   { outDir, appOutDir, packager, electronPlatformName, arch, targets }
// 项目根不在 Context 上，需要走 context.packager.projectDir（Packager 类的字段，
// PlatformPackager 继承自 Packager）。
//
// 本文件保持 CommonJS（require/module.exports）写法以便被 electron-builder
// Node 端直接 require()，不切 ESM：项目 package.json 未设 type: module，
// 切 ESM 后 require is not defined。@typescript-eslint/no-require-imports
// 规则对 require() 报错，所以这里禁用此规则。
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const appOutDir = context && context.appOutDir;
  const projectDir = context && context.packager && context.packager.projectDir;
  if (!appOutDir || !projectDir) {
    throw new Error(
      `[after-pack] 上下文路径缺失：appOutDir=${appOutDir} projectDir=${projectDir}\n` +
      '  context=' + JSON.stringify({
        appOutDir: context && context.appOutDir,
        outDir: context && context.outDir,
        hasPackager: Boolean(context && context.packager),
        packagerProjectDir: context && context.packager && context.packager.projectDir,
      })
    );
  }

  const srcDsh = path.join(projectDir, 'resources', 'dsh');
  const destDsh = path.join(appOutDir, 'resources', 'dsh');
  const srcBin = path.join(srcDsh, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const destBin = path.join(destDsh, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');

  // 源 dsh 不存在：直接报错，避免漏装 dsh 的安装包再次流出。
  // 这里不应静默跳过——build 链路前一步 pnpm bundle:dsh 已经保证 resources/dsh
  // 就绪，如果不在说明 bundle-dsh 出问题，必须显式失败。
  if (!fs.existsSync(srcBin)) {
    throw new Error(
      `[after-pack] 源 dsh 运行时缺失：${srcBin}\n` +
      '  请先跑 `pnpm bundle:dsh` 重新拉取 dsh 全家桶；' +
      '若 `DSH_PACKAGE_ROOT` 未设、且本地 node_modules 与 G:\\DSH 都没装 dsh，' +
      '参见 scripts/bundle-dsh.mjs 候选链说明。'
    );
  }

  // 先清掉目标里可能存在的旧产物，避免子目录残留导致后续 portable/NSIS
  // 把残留当作"已复制"从而忽略新内容。
  if (fs.existsSync(destDsh)) {
    fs.rmSync(destDsh, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(destDsh), { recursive: true });

  // recursive + force 同步复制——245 MB 的 node_modules 在 pnpm 平铺目录结构下
  // 几秒即可完成；没必要拆并发，cpSync 内部已经高效。
  fs.cpSync(srcDsh, destDsh, { recursive: true, force: true });

  // 复制完整性校验：bin.js 是 dsh 入口最稳定的文件，能进就能跑。
  if (!fs.existsSync(destBin)) {
    throw new Error(`[after-pack] dsh 复制后 bin.js 仍不存在：${destBin}`);
  }

  // 体积粗校验——dsh 全家桶应该 ≥200 MB，小于 100 MB 必有大量文件丢失。
  let sizeBytes = 0;
  const stack = [destDsh];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
      } else if (entry.isFile()) {
        try {
          sizeBytes += fs.statSync(p).size;
        } catch {
          // 文件在复制过程中可能短暂不可访问，忽略单文件错误
        }
      }
    }
  }
  const sizeMB = Math.round(sizeBytes / 1024 / 1024);
  if (sizeMB < 100) {
    throw new Error(
      `[after-pack] dsh 复制后体积异常（${sizeMB} MB < 100 MB），怀疑大量文件丢失。` +
      '请检查源 resources/dsh 完整性，或提交 issue。'
    );
  }
  console.log(`[after-pack] dsh 已嵌入 ${destDsh}（${sizeMB} MB，bin.js 校验通过）`);
};