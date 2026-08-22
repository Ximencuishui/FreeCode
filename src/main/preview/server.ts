import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, watch, type FSWatcher } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
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

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number | null {
    return this.port;
  }

  /** 加载（或热重载）项目内的后端处理器 server.js */
  private loadApiHandler(): void {
    this.apiHandler = null;
    if (!this.projectPath) return;
    const serverPath = path.join(this.projectPath, 'server.js');
    try {
      const require = createRequire(__filename);
      delete require.cache[require.resolve(serverPath)];
      const mod = require(serverPath) as { handleApi?: ApiHandler } | undefined;
      if (mod && typeof mod.handleApi === 'function') {
        this.apiHandler = mod.handleApi;
      }
    } catch {
      // 项目无后端（纯静态应用）：忽略
      this.apiHandler = null;
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

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', () => {
        this.server!.removeListener('error', reject);
        resolve();
      });
    });

    // 文件变更监听（callback 版 watch，Windows 下 recursive 可用）
    this.watcher = watch(projectPath, { recursive: true }, () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        // 后端运行时热重载（server.js 被修改时生效）
        this.loadApiHandler();
        this.emit('file-change');
      }, DEBOUNCE_MS);
    });

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
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '后端尚未就绪（项目无 server.js？）' }));
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
      const result = await this.apiHandler(req.method ?? 'GET', rawPath, bodyText, req.headers);
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
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '后端处理出错' }));
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
