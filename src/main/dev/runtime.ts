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

/** 运行时资源目录：打包后位于 process.resourcesPath/app-runtime；开发/测试在仓库根 resources/ */
export function getRuntimeDir(): string {
  // 测试环境无 process.resourcesPath，跳过打包目录探测
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    const packagedDir = path.join(process.resourcesPath, 'app-runtime');
    try {
      if (fs.existsSync(packagedDir)) return packagedDir;
    } catch {
      /* ignore */
    }
  }
  // src/main/dev → 仓库根（dist 下同理：dist/main/dev → 根）
  return path.resolve(__dirname, '..', '..', '..', 'resources', 'app-runtime');
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
    } catch {
      // 目录不存在 / 只读等：忽略，后端登录为可选增强
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
  } catch {
    // WASM 复制失败不阻塞
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
    } catch {
      // ignore
    }
  }
}
