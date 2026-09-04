#!/usr/bin/env node
/**
 * 把本地 release/ 产物发布到 GitHub Release。
 *
 * 设计意图：
 *   - 本地手工 `pnpm package` 完成后，仓库管理员跑这个脚本，把 `release/*.exe`
 *     上传到对应 git tag 的 GitHub Release 页面。
 *   - 与 CI 的 `softprops/action-gh-release@v2` 互为补充：CI 用时间戳 tag 自动发，
 *     本脚本读 `.tools/release-config.json` 用规范 tag（如 `v0.1.10`）手动发。
 *   - 不引入额外依赖（避免 gh CLI / octokit 体积），纯 Node + https 标准库。
 *
 * 用法：
 *   node scripts/publish-github-release.mjs --token <GH_TOKEN> [--dry-run]
 *   # 或：GH_TOKEN=xxx node scripts/publish-github-release.mjs
 *
 * 安全：
 *   - token 仅经命令行参数或环境变量传入，不落盘、不打印
 *   - 仅 HTTPS POST，无第三方依赖
 *
 * 依赖 .tools/release-config.json 的字段：
 *   - tag_name         e.g. "v0.1.10"
 *   - target_commitish e.g. "cc81339..." (commit SHA，必填以锚定版本)
 *   - name             e.g. "FreeCoder 0.1.10 - ..."
 *   - body_markdown_path  e.g. "RELEASE-NOTES-v0.1.10.md"
 *   - draft            boolean（默认 false）
 *   - prerelease       boolean（默认 false）
 */
import { readFileSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { URL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPO = 'Ximencuishui/FreeCode'; // 与 package.json → electron-builder.yml.appId 对齐
const RELEASE_DIR = join(ROOT, 'release');

// --- args ---

function parseArgs(argv) {
  const out = { token: process.env.GH_TOKEN ?? null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--token') out.token = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '-h' || a === '--help') {
      console.log(
        [
          'Usage: node scripts/publish-github-release.mjs --token <GH_TOKEN> [--dry-run]',
          '',
          'Environment:',
          '  GH_TOKEN   GitHub PAT with repo scope (alternative to --token)',
          '',
          'Reads:',
          '  .tools/release-config.json',
          '  .tools/<body_markdown_path>',
          '  release/*.exe (uploaded as release assets)',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      console.error(`[publish-github-release] unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

// --- helpers ---

function loadConfig() {
  const cfgPath = join(ROOT, '.tools', 'release-config.json');
  const raw = readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function loadBody(bodyPath) {
  // body_markdown_path 约定相对于 .tools/ 目录
  const abs = join(ROOT, '.tools', bodyPath);
  return readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
}

function listReleaseExecutables(version) {
  // 仅上传本次版本对应的产物 + latest.yml，不递归（避免上传 win-unpacked 等大目录）
  // 产物命名约定由 electron-builder 的 ${version} 模板决定：
  //   - <productName> <version>.exe                    → FreeCoder 0.1.10.exe
  //   - <productName> Setup <version>.exe              → FreeCoder Setup 0.1.10.exe
  //   - <productName> Setup <version>.exe.blockmap     → FreeCoder Setup 0.1.10.exe.blockmap
  //   - latest.yml                                      → electron-updater 元数据
  // 通过 `<空格>version.` 与 `<空格>version.exe.blockmap` 锁定，避免匹配历史包（如 0.1.9）。
  const versionLiteral = ` ${version}`;
  const allowFile = new Set(['latest.yml']);
  return readdirSync(RELEASE_DIR)
    .filter((name) => {
      const p = join(RELEASE_DIR, name);
      if (statSync(p).isDirectory()) return false;
      if (allowFile.has(name)) return true;
      // 仅保留本次版本的 .exe / .blockmap（`<空格>version` 前后必须有边界，避免 0.1.1 误命中 0.1.10）
      if (name.endsWith('.exe.blockmap') && name.includes(versionLiteral)) return true;
      if (name.endsWith('.exe') && name.includes(`${versionLiteral}.`)) return true;
      return false;
    })
    .map((name) => ({
      name,
      size: statSync(join(RELEASE_DIR, name)).size,
      path: join(RELEASE_DIR, name),
    }));
}

function githubRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + (u.search ?? ''),
        headers: {
          'User-Agent': 'FreeCoder-publish-github-release',
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null });
            } catch {
              resolve({ status: res.statusCode, json: null });
            }
          } else {
            reject(new Error(`GitHub API ${res.statusCode}: ${text}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function createRelease(token, payload) {
  return githubRequest(
    'POST',
    `https://api.github.com/repos/${REPO}/releases`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    JSON.stringify(payload),
  );
}

async function uploadAsset(uploadUrlTemplate, token, asset) {
  // uploadUrlTemplate 含 {?name,label} 占位符；用 ?name=<filename> 替换
  const url = uploadUrlTemplate.replace('{?name,label}', `?name=${encodeURIComponent(asset.name)}`);
  const contentType =
    asset.name.endsWith('.exe')
      ? 'application/x-msdownload'
      : asset.name.endsWith('.blockmap')
      ? 'application/octet-stream'
      : 'application/octet-stream';
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + (u.search ?? ''),
        headers: {
          'User-Agent': 'FreeCoder-publish-github-release',
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${token}`,
          'Content-Type': contentType,
          'Content-Length': asset.size,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[publish-github-release]   ✓ uploaded ${asset.name} (${(asset.size / 1024 / 1024).toFixed(2)} MB)`);
            resolve();
          } else {
            reject(new Error(`Upload ${asset.name} failed ${res.statusCode}: ${text}`));
          }
        });
      },
    );
    req.on('error', reject);
    createReadStream(asset.path).on('error', reject).pipe(req);
  });
}

// --- main ---

async function main() {
  const args = parseArgs(process.argv);
  if (!args.token) {
    console.error('[publish-github-release] missing token. Pass --token <GH_TOKEN> or set GH_TOKEN env var.');
    process.exit(2);
  }

  const cfg = loadConfig();
  if (!cfg.tag_name || !cfg.target_commitish || !cfg.name || !cfg.body_markdown_path) {
    console.error('[publish-github-release] release-config.json missing required fields (tag_name / target_commitish / name / body_markdown_path).');
    process.exit(2);
  }

  const body = loadBody(cfg.body_markdown_path);
  // tag_name 形如 "v0.1.10"，去掉 v 前缀得到 version，与 electron-builder 产物命名对齐
  const version = cfg.tag_name.replace(/^v/, '');
  const assets = listReleaseExecutables(version);
  if (assets.length === 0) {
    console.error(`[publish-github-release] no .exe/.blockmap/latest.yml found in ${RELEASE_DIR}. Run 'pnpm package' first.`);
    process.exit(2);
  }

  console.log('[publish-github-release] target:');
  console.log(`  repo       ${REPO}`);
  console.log(`  tag_name   ${cfg.tag_name}`);
  console.log(`  commitish  ${cfg.target_commitish}`);
  console.log(`  name       ${cfg.name}`);
  console.log(`  body       .tools/${cfg.body_markdown_path} (${body.length} chars)`);
  console.log(`  draft      ${cfg.draft ?? false}`);
  console.log(`  prerelease ${cfg.prerelease ?? false}`);
  console.log(`  assets     ${assets.length} file(s):`);
  for (const a of assets) console.log(`    - ${a.name} (${(a.size / 1024 / 1024).toFixed(2)} MB)`);

  if (args.dryRun) {
    console.log('[publish-github-release] --dry-run: skip create + upload.');
    return;
  }

  console.log('[publish-github-release] creating release...');
  const { json: release } = await createRelease(args.token, {
    tag_name: cfg.tag_name,
    target_commitish: cfg.target_commitish,
    name: cfg.name,
    body,
    draft: cfg.draft ?? false,
    prerelease: cfg.prerelease ?? false,
  });
  console.log(`[publish-github-release]   ✓ release ${release.html_url}`);

  console.log('[publish-github-release] uploading assets...');
  for (const a of assets) {
    await uploadAsset(release.upload_url, args.token, a);
  }
  console.log(`[publish-github-release] done. View: ${release.html_url}`);
}

main().catch((err) => {
  console.error(`[publish-github-release] FAILED: ${err.message}`);
  process.exit(1);
});