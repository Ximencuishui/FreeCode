/**
 * dev 进程包装：在 vite 之上捕获 EBUSY 等瞬态文件锁错误，避免 dev server 在编辑器原子写
 * （create-temp-dir/.tmp → rename）期间崩溃。Windows 上 chokidar/node fs watcher 在某些
 * 临时路径上抛 EBUSY 是已知问题；这里吞掉与 watch/EBUSY/UVE 相关的未处理错误让 vite
 * 继续运行，而不是整个 dev session 死亡。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// 忽略的未处理错误：dev server 在 Windows EBUSY 上常见但都是瞬态
const shouldIgnore = (err) => {
  if (!err) return false;
  const msg = String(err.message ?? err);
  return (
    err.code === 'EBUSY' ||
    err.code === 'UVE' ||
    msg.includes('EBUSY') ||
    msg.includes('resource busy') ||
    msg.includes('UVE')
  );
};

process.on('uncaughtException', (err) => {
  if (shouldIgnore(err)) {
    console.warn('[dev-runner] ignored uncaught:', err.code ?? '', err.message);
    return;
  }
  console.error('[dev-runner] uncaught:', err);
  process.exit(1);
});

// unhandledRejection：Node 默认只 warn 不退出（除非 --unhandled-rejections=strict）。
// 这里保持默认行为——只记录，不 process.exit。主进程（Electron）内部的一些良性
// rejection（如 PreviewServer 加载 server.js 时 sql.js 的 ErrnoError）不该杀死 vite dev。
process.on('unhandledRejection', (reason) => {
  if (shouldIgnore(reason)) {
    console.warn('[dev-runner] ignored rejection:', reason?.code ?? '', reason?.message ?? reason);
    return;
  }
  console.warn('[dev-runner] unhandledRejection (non-fatal):', reason?.message ?? reason);
});

// 把 cwd 切到项目根后直接 import vite 的 CLI，确保 vite 跑在当前进程以便 uncaughtException 生效
process.chdir(root);
// 通过文件绝对路径 import 绕过 pnpm exports 隔离（vite 的 bin/vite.js 没有通过 exports 暴露）
await import(pathToFileURL(path.resolve(root, 'node_modules/vite/bin/vite.js')).href);