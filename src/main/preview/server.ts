import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, watch, type FSWatcher } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { EventEmitter } from 'node:events';

/**
 * 本地预览服务器（架构文档 4.2.5）：
 * - 静态托管 DSH 生成的项目代码（HTML/CSS/JS）
 * - `/api/*` 请求转发给项目内 server.js（FreeCoder 登录后端运行时），支持热重载
 * - 端口范围 [3000, 3010] 自动避让
 * - 文件变更监听 → 热加载通知（reload 事件）
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export interface PreviewServerInfo {
  url: string;
  port: number;
}

const DEBOUNCE_MS = 300;
/** API 请求体大小上限（1MB，与部署端 server.js 一致） */
const MAX_BODY_BYTES = 1024 * 1024;

/** server.js 导出的 API 处理器契约 */
export type ApiHandler = (
  method: string,
  urlPath: string,
  bodyText: string,
  headers: http.IncomingHttpHeaders,
) =>
  | { status: number; body: unknown; headers?: Record<string, string>; _isHtml?: boolean; _asyncOAuth?: boolean }
  | Promise<{ status: number; body: unknown; headers?: Record<string, string>; _isHtml?: boolean; _asyncOAuth?: boolean }>;

/** 在 [start, end] 端口范围内寻找可用端口 */
export function findAvailablePort(start: number, end: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number) => {
      const probe = net.createServer();
      probe.unref();
      probe.on('error', () => {
        if (port >= end) {
          reject(new Error(`预览端口 ${start}-${end} 均不可用`));
        } else {
          tryListen(port + 1);
        }
      });
      probe.listen(port, '127.0.0.1', () => {
        probe.close(() => resolve(port));
      });
    };
    tryListen(start);
  });
}

/** 本地预览服务器：事件 'file-change'（防抖后触发） */
export class PreviewServer extends EventEmitter {
  private server: http.Server | null = null;
  private watcher: FSWatcher | null = null;
  private projectPath: string | null = null;
  private port: number | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  /** 项目内 server.js 导出的 API 处理器（登录后端） */
  private apiHandler: ApiHandler | null = null;
  /** server.js 加载失败时的真实错误（供 /api 503 响应与日志展示） */
  private loadError: string | null = null;

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number | null {
    return this.port;
  }

  /** 加载（或热重载）项目内的后端处理器 server.js */
  private loadApiHandler(): void {
    this.apiHandler = null;
    this.loadError = null;
    if (!this.projectPath) return;
    const serverPath = path.join(this.projectPath, 'server.js');
    try {
      const projectNodeModules = path.join(this.projectPath, 'node_modules');
      // 清掉项目 sql.js 模块缓存：sql.js 的 WASM 初始化 Promise 失败后会被永久缓存，
      // 只重载 server.js 无法恢复（require('sql.js') 会命中同一份被拒绝的 Promise）
      const sharedCache = (Module as unknown as { _cache?: Record<string, unknown> })._cache ?? require.cache;
      for (const cachedPath of Object.keys(sharedCache)) {
        if (
          cachedPath.startsWith(projectNodeModules + path.sep) &&
          cachedPath.includes(`${path.sep}sql.js${path.sep}`)
        ) {
          delete sharedCache[cachedPath];
        }
      }
      // 直接编译一个全新的 Module 实例（不依赖 Module._cache / require.cache），
      // 保证项目 server.js 被毒化（dbReady 永久 rejected）后能彻底重新执行
      // useSync: false 走异步读；用同步读避免把 async 塞进同步流程
      const fsSync = require('node:fs') as typeof import('node:fs');
      const source = fsSync.readFileSync(serverPath, 'utf8');
      const fresh = new Module(serverPath);
      fresh.filename = serverPath;
      fresh.paths = (Module as unknown as { _nodeModulePaths: (p: string) => string[] })._nodeModulePaths(
        path.dirname(serverPath),
      );
      (fresh as unknown as { _compile: (src: string, file: string) => void })._compile(source, serverPath);
      const mod = fresh.exports as { handleApi?: ApiHandler } | undefined;
      if (mod && typeof mod.handleApi === 'function') {
        this.apiHandler = mod.handleApi;
        return;
      }
      // 模块存在但未导出 handleApi：可能是纯静态应用（server.js 只是占位）
      this.loadError = 'server.js 未导出 handleApi';
    } catch (err) {
      // 记录真实错误而不是静默吞掉：模块加载失败（语法错误/依赖缺失）时用户需要可诊断的信息
      this.loadError = err instanceof Error ? err.message : String(err);
      console.warn('[preview] 加载项目后端 server.js 失败:', this.loadError);
    }
  }

  /**
   * 调用项目后端，带一次性自愈重试。
   * 项目 server.js 的 SQLite 初始化（sql.js WASM）存在偶发失败（如内存不足），
   * 一旦失败其 dbReady Promise 永久 rejected，此后所有 /api 请求都会 500，
   * 且仅重启应用才能恢复。这里在后端调用抛错时重载模块重试一次，自动恢复。
   */
  private async callApiWithRecovery(
    method: string,
    urlPath: string,
    bodyText: string,
    headers: http.IncomingHttpHeaders,
  ): Promise<Awaited<ReturnType<ApiHandler>>> {
    if (!this.apiHandler) {
      // 启动时加载失败：给一次重载机会（瞬态失败，如 sql.js 初始化内存不足）
      this.loadApiHandler();
    }
    const handler = this.apiHandler;
    if (!handler) {
      throw new Error(this.loadError ?? '后端尚未就绪');
    }
    try {
      return await handler(method, urlPath, bodyText, headers);
    } catch (err) {
      // 一次性自愈：重载 server.js（新模块实例的数据库初始化重新执行）后重试一次
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[preview] 后端调用失败，重载 server.js 后重试:', msg);
      this.loadApiHandler();
      const retried = this.apiHandler;
      if (retried) {
        try {
          return await retried(method, urlPath, bodyText, headers);
        } catch (e2) {
          // 把异域抛出的对象（jest VM 等场景下 e2 instanceof Error 可能为 false）
          // 统一包装为本域 Error，确保上游能稳定取到 message
          const e2Msg = e2 instanceof Error
            ? e2.message
            : typeof e2 === 'object' && e2 !== null && 'message' in e2
              ? String((e2 as { message: unknown }).message)
              : String(e2);
          throw new Error(e2Msg);
        }
      }
      throw new Error(`${msg}${this.loadError ? `；重载失败：${this.loadError}` : ''}`);
    }
  }

  /** 启动预览服务器，托管 projectPath 目录 */
  async start(projectPath: string): Promise<PreviewServerInfo> {
    if (this.server) {
      throw new Error('预览已在运行');
    }
    const port = await findAvailablePort(3000, 3010);
    this.projectPath = projectPath;
    this.port = port;
    this.loadApiHandler();
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(port, '127.0.0.1', () => {
          this.server!.removeListener('error', reject);
          resolve();
        });
      });
    } catch (err) {
      // 启动失败时清理内部状态，避免再次 start() 抛「已在运行」导致用户无法重试
      this.server?.removeAllListeners();
      this.server = null;
      this.projectPath = null;
      this.port = null;
      this.apiHandler = null;
      this.loadError = null;
      throw err;
    }

    // 文件变更监听（callback 版 watch，Windows 下 recursive 可用）。
    // 项目目录通常含 node_modules/、data/ 等大量子文件，fs.watch 在 Windows 上
    // 对递归订阅非常容易抛 EBUSY（异步）。这里注册 error 处理器吞掉瞬态 EBUSY，
    // 避免 watcher 异常终止导致预览服务器整体崩溃或渲染器无热重载信号。
    try {
      this.watcher = watch(projectPath, { recursive: true }, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          // 后端运行时热重载（server.js 被修改时生效）
          this.loadApiHandler();
          this.emit('file-change');
        }, DEBOUNCE_MS);
      });
      this.watcher.on('error', (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('EBUSY') || msg.includes('resource busy')) {
          console.warn('[preview] watcher ignored EBUSY:', msg);
          return;
        }
        console.warn('[preview] watcher error:', msg);
      });
    } catch (err) {
      // 同步抛错（如 OS 不支持 recursive watch）也吞掉，保留热重载以外的预览能力
      console.warn('[preview] watcher init failed:', err instanceof Error ? err.message : err);
    }

    return { url: `http://localhost:${port}`, port };
  }

  /** 停止服务器并释放端口 */
  async stop(): Promise<void> {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const srv = this.server;
    this.server = null;
    this.port = null;
    this.projectPath = null;
    this.apiHandler = null;
    this.loadError = null;
    if (srv) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  }

  /** 处理 /api/* 请求：透传给项目内 server.js 的 handleApi，返回 JSON */
  private async handleApiRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    rawPath: string,
  ): Promise<void> {
    if (!this.apiHandler) {
      // 启动时后端加载失败：先重载一次（瞬态失败自愈），仍无后端则返回 503
      this.loadApiHandler();
    }
    if (!this.apiHandler) {
      const detail = this.loadError ? `（${this.loadError}）` : '（项目无 server.js？）';
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `后端尚未就绪${detail}` }));
      return;
    }

    // 收集请求体（限制 1MB）
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size <= MAX_BODY_BYTES) chunks.push(buf);
    }
    const bodyText = Buffer.concat(chunks).toString('utf8');

    try {
      const result = await this.callApiWithRecovery(req.method ?? 'GET', rawPath, bodyText, req.headers);
      const status = typeof result.status === 'number' ? result.status : 500;

      // OAuth 异步 token 交换：需要调用 exchangeOAuthToken
      if (result._asyncOAuth) {
        try {
          const serverPath = path.join(this.projectPath!, 'server.js');
          const require = createRequire(__filename);
          const mod = require(serverPath) as {
            exchangeOAuthToken?: (p: string, c: string) => Promise<unknown>;
          };
          if (typeof mod.exchangeOAuthToken === 'function') {
            const oauthBody = (result.body ?? {}) as { provider?: string; code?: string };
            const oauthResult = await mod.exchangeOAuthToken(
              oauthBody.provider ?? '',
              oauthBody.code ?? '',
            );
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(oauthResult));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '后端不支持 OAuth token 交换' }));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : '未知错误';
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'OAuth 处理出错: ' + msg }));
        }
        return;
      }

      // HTML 响应（OAuth 回调页面等）
      if (result._isHtml) {
        const contentType = result.headers?.['Content-Type'] || 'text/html; charset=utf-8';
        res.writeHead(status, { 'Content-Type': contentType });
        res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
        return;
      }

      // 重定向
      if (status === 302 && result.headers?.Location) {
        res.writeHead(302, { Location: result.headers.Location });
        res.end();
        return;
      }

      // 普通 JSON 响应
      const respHeaders: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        ...(result.headers || {}),
      };
      res.writeHead(status, respHeaders);
      res.end(JSON.stringify(result.body));
    } catch (err) {
      // 返回真实错误信息（而非笼统的 500），让渲染层能给用户可诊断的提示
      const msg = err instanceof Error ? err.message : '后端处理出错';
      console.warn('[preview] API 处理出错:', msg);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: msg }));
    }
  }

  /** 解析请求路径到项目内文件，防止目录穿越 */
  private resolveFilePath(urlPath: string): string | null {
    if (!this.projectPath) return null;
    const decoded = decodeURIComponent(urlPath);
    const relative = decoded.replace(/^\/+/, '');
    const filePath = path.resolve(this.projectPath, relative);
    const root = path.resolve(this.projectPath);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return null;
    }
    return filePath;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (!this.projectPath) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('预览尚未就绪');
        return;
      }

      // 使用原始 request-target（避免 WHATWG URL 折叠编码的 .. 段）
      const rawPath = (req.url ?? '/').split('?')[0];

      // API 请求转发给项目内 server.js（登录后端）
      if (rawPath.startsWith('/api/')) {
        await this.handleApiRequest(req, res, rawPath);
        return;
      }

      let filePath = this.resolveFilePath(rawPath);
      if (!filePath) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        stat = await fs.stat(filePath).catch(() => null);
      }
      if (!stat?.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Error');
    }
  }
}
