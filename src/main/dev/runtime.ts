import fs from 'node:fs';
import fsP from 'node:fs/promises';
import path from 'node:path';

/**
 * 应用运行时注入器（主工作流「带后端应用」的地基）。
 * 开发完成后把 FreeCoder 提供的标准后端运行时（server.js + auth.js）注入项目代码目录：
 * - server.js：纯 Node 零依赖，实现 JWT 登录 / 用户存储 / API（预览与部署共用）
 * - auth.js：前端登录 SDK（window.FreeCoderAuth + 内置登录弹窗）
 * 注入是幂等的：目标已存在（AI 或用户生成的版本）则跳过，绝不覆盖。
 */

export const RUNTIME_FILES = ['server.js', 'auth.js', 'package.json'] as const;

/** sql.js WASM 文件（相对于 app-runtime 目录），注入时需一并复制 */
const SQLJS_WASM_FILE = 'node_modules/sql.js/dist/sql-wasm.wasm';

/**
 * packagedDir 是否包含运行所必需的关键文件（至少 server.js + auth.js）。
 * 历史上出现过 process.resourcesPath 指向 E:\resources（开发/测试环境），
 * packagedDir 目录存在但内部文件缺失（残留/未完整），导致注入全部 ENOENT、preview 后端空白。
 * 探测关键文件可避免误把空壳目录当成有效 runtime 目录。
 */
function hasCompleteRuntimeFiles(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, 'auth.js'));
  } catch {
    return false;
  }
}

/** 运行时资源目录：打包后位于 process.resourcesPath/app-runtime；开发/测试在仓库根 resources/ */
export function getRuntimeDir(): string {
  // 测试环境无 process.resourcesPath，跳过打包目录探测
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    const packagedDir = path.join(process.resourcesPath, 'app-runtime');
    try {
      // 检测 resourcesPath 是否有效：必须是存在的目录，且不是盘符根（如 "E:\" 长度为 3），
      // 且关键文件齐全（避免命中残留/不完整的 packagedDir 导致注入全失败）。
      const isValidResourcesPath =
        fs.existsSync(packagedDir) &&
        fs.statSync(process.resourcesPath).isDirectory() &&
        process.resourcesPath.length > 3 &&
        hasCompleteRuntimeFiles(packagedDir);
      if (isValidResourcesPath) return packagedDir;
    } catch {
      /* ignore */
    }
  }
  // 候选 fallback 路径：
  // - vite-plugin-electron 把所有 main 代码打包成单文件 dist/main/index.js（__dirname = dist/main）
  // - 源码运行（jest 等）时 __dirname = src/main/dev
  // - 测试夹具或特殊环境下 __dirname 可能再深一层
  // 按"第一个存在的目录"挑选，避免硬编码层级
  const fallbackCandidates = [
    path.resolve(__dirname, '..', 'resources', 'app-runtime'),
    path.resolve(__dirname, '..', '..', 'resources', 'app-runtime'),
    path.resolve(__dirname, '..', '..', '..', 'resources', 'app-runtime'),
    path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'app-runtime'),
  ];
  for (const dir of fallbackCandidates) {
    if (fs.existsSync(dir) && hasCompleteRuntimeFiles(dir)) return dir;
  }
  // 都没有：返回最可能正确的路径（dist/main → 仓库根）
  return fallbackCandidates[0];
}

/** 注入登录运行时到项目代码目录（幂等；任何失败静默，不阻塞开发流程） */
export async function injectAuthRuntime(codePath: string): Promise<void> {
  const runtimeDir = getRuntimeDir();

  // 复制核心文件（server.js / auth.js / package.json）
  for (const file of RUNTIME_FILES) {
    try {
      const dest = path.join(codePath, file);
      await fsP
        .access(dest)
        .then(() => undefined) // 已存在：保留现有版本
        .catch(() => fsP.copyFile(path.join(runtimeDir, file), dest));
    } catch (err) {
      // 目录不存在 / 只读等：不阻塞开发流程，但记录日志便于排查
      console.warn(`[runtime] 注入 ${file} 失败:`, err instanceof Error ? err.message : err);
    }
  }

  // 复制 sql.js WASM 文件（server.js 依赖）
  try {
    const wasmSrc = path.join(runtimeDir, SQLJS_WASM_FILE);
    const wasmDest = path.join(codePath, SQLJS_WASM_FILE);
    await fsP.access(wasmDest).catch(async () => {
      await fsP.mkdir(path.dirname(wasmDest), { recursive: true });
      await fsP.copyFile(wasmSrc, wasmDest);
    });
  } catch (err) {
    console.warn('[runtime] 注入 sql-wasm.wasm 失败:', err instanceof Error ? err.message : err);
  }

  // 复制 sql.js JS 入口（node_modules/sql.js/dist/sql-wasm.js + index 等）
  const sqlJsDistFiles = [
    'node_modules/sql.js/dist/sql-wasm.js',
    'node_modules/sql.js/package.json',
  ];
  for (const relPath of sqlJsDistFiles) {
    try {
      const src = path.join(runtimeDir, relPath);
      const dest = path.join(codePath, relPath);
      await fsP.access(dest).catch(async () => {
        await fsP.mkdir(path.dirname(dest), { recursive: true });
        await fsP.copyFile(src, dest);
      });
    } catch (err) {
      console.warn(`[runtime] 注入 ${relPath} 失败:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * 预览自愈：确保项目代码目录包含登录运行时（auth.js / server.js）。
 * 老项目（运行时功能上线前开发完成）缺少注入，预览前调用此函数补齐。
 *
 * 本地模式保护：扫描 index.html / app.js / 同目录其他 .html / .js，若**完全
 * 不包含** `FreeCoderAuth` / `auth.js` 引用，则视为本地模式项目，跳过补注入
 * ——避免给纯前端应用挂上一个未使用的登录后端运行时。
 * 返回是否发生了补注入。
 */
export async function ensureAuthRuntime(codePath: string): Promise<boolean> {
  // 本地模式项目特征：业务代码里没有 FreeCoderAuth / auth.js 引用。
  // 注意：项目代码本身是 DSH 生成的，不能从 requirements 读取（这里是运行时，不带 storage）。
  // 检测方式：扫 *.html / *.js（含 .mjs）是否存在任一关键字。
  const looksLikeLocalMode = await detectLocalMode(codePath);
  if (looksLikeLocalMode) {
    // 本地模式：项目不依赖 server.js / auth.js，直接跳过自愈
    return false;
  }

  const missing = (
    await Promise.all(
      RUNTIME_FILES.map(async (file) => {
        try {
          await fsP.access(path.join(codePath, file));
          return false;
        } catch {
          return true;
        }
      }),
    )
  ).some(Boolean);
  if (missing) {
    console.warn(`[runtime] 检测到代码目录缺少登录运行时，执行补注入: ${codePath}`);
    await injectAuthRuntime(codePath);
    return true;
  }
  return false;
}

/** 项目代码是否属于本地模式（不需要登录后端运行时）。
 *  扫描 codePath 下的 .html / .js / .mjs（限根目录与一层子目录，避免过深爆栈），
 *  若命中 `FreeCoderAuth` 或 `auth.js` 引用则视为登录模式；否则视为本地模式。 */
async function detectLocalMode(codePath: string): Promise<boolean> {
  const KEY = /(FreeCoderAuth|auth\.js)/;
  try {
    const entries = await fsP.readdir(codePath, { withFileTypes: true });
    const candidates: string[] = [];
    for (const ent of entries) {
      if (ent.isFile() && /\.(html|js|mjs)$/i.test(ent.name)) {
        candidates.push(path.join(codePath, ent.name));
      } else if (ent.isDirectory()) {
        // 一层子目录（如 assets/js）也参与扫描
        try {
          const sub = await fsP.readdir(path.join(codePath, ent.name), { withFileTypes: true });
          for (const s of sub) {
            if (s.isFile() && /\.(html|js|mjs)$/i.test(s.name)) {
              candidates.push(path.join(codePath, ent.name, s.name));
            }
          }
        } catch {
          /* 子目录不可读：忽略 */
        }
      }
    }
    for (const file of candidates) {
      try {
        const content = await fsP.readFile(file, 'utf8');
        if (KEY.test(content)) return false; // 命中关键字 → 登录模式
      } catch {
        /* 单个文件读不出来不影响判定 */
      }
    }
    // 一个关键字都没命中 → 本地模式
    return true;
  } catch {
    // codePath 不存在 / 不可读：视为本地模式（无代码就不需要后端）
    return true;
  }
}
