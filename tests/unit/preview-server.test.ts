import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import { PreviewServer, findAvailablePort } from '../../src/main/preview/server';

/**
 * 预览服务器单元测试（测试计划 5.2.3 IT-PRV-001~005）。
 */

async function makeProjectDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-preview-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><html><body><h1>我的记账本</h1></body></html>', 'utf-8');
  await fs.writeFile(path.join(dir, 'style.css'), 'h1 { color: #4A90D9; }', 'utf-8');
  return dir;
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res: http.IncomingMessage) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString('utf-8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

describe('预览服务器（IT-PRV）', () => {
  it('IT-PRV-001 启动预览：返回 URL 与端口，页面可访问', async () => {
    const dir = await makeProjectDir();
    const server = new PreviewServer();
    try {
      const info = await server.start(dir);
      expect(info.url).toMatch(/^http:\/\/localhost:\d+$/);
      expect(info.port).toBeGreaterThanOrEqual(3000);
      expect(info.port).toBeLessThanOrEqual(3010);
      expect(server.isRunning()).toBe(true);

      const res = await httpGet(info.url);
      expect(res.status).toBe(200);
      expect(res.body).toContain('我的记账本');
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('IT-PRV-002 静态资源：CSS 等文件正常返回', async () => {
    const dir = await makeProjectDir();
    const server = new PreviewServer();
    try {
      const { url } = await server.start(dir);
      const res = await httpGet(`${url}/style.css`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('#4A90D9');
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('IT-PRV-003 目录访问：默认返回 index.html', async () => {
    const dir = await makeProjectDir();
    const server = new PreviewServer();
    try {
      const { url } = await server.start(dir);
      const res = await httpGet(url);
      expect(res.status).toBe(200);
      expect(res.body).toContain('我的记账本');
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('IT-PRV-004 端口冲突：占用 3000 后自动使用下一端口', async () => {
    // 占用 3000
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(3000, '127.0.0.1', resolve));

    const dir = await makeProjectDir();
    const server = new PreviewServer();
    try {
      const info = await server.start(dir);
      expect(info.port).toBe(3001);
    } finally {
      await server.stop();
      blocker.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('IT-PRV-005 停止预览：服务器关闭，端口释放', async () => {
    const dir = await makeProjectDir();
    const server = new PreviewServer();
    const { port } = await server.start(dir);
    await server.stop();
    expect(server.isRunning()).toBe(false);

    // 端口可重新监听
    const probe = net.createServer();
    await expect(
      new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', () => resolve());
      }),
    ).resolves.toBeUndefined();
    probe.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('路径穿越防护：越界请求返回 403', async () => {
    const dir = await makeProjectDir();
    const server = new PreviewServer();
    try {
      const { port } = await server.start(dir);
      // 用 http.request 直接指定原始 path（客户端 URL 解析会折叠编码的 ..）
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/%2e%2e/package.json', method: 'GET' },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(403);
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('findAvailablePort：范围探测', async () => {
    const port = await findAvailablePort(3100, 3105);
    expect(port).toBeGreaterThanOrEqual(3100);
    expect(port).toBeLessThanOrEqual(3105);
  });
});
