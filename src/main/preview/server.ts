import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, watch, type FSWatcher } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { EventEmitter } from 'node:events';

/**
 * 本地预览服务器（架构文档 4.2.5）：
 * - 静态托管 DSH 生成的项目代码（HTML/CSS/JS）
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

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number | null {
    return this.port;
  }

  /** 启动预览服务器，托管 projectPath 目录 */
  async start(projectPath: string): Promise<PreviewServerInfo> {
    if (this.server) {
      throw new Error('预览已在运行');
    }
    const port = await findAvailablePort(3000, 3010);
    this.projectPath = projectPath;
    this.port = port;
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
      this.debounceTimer = setTimeout(() => this.emit('file-change'), DEBOUNCE_MS);
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
    if (srv) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
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
