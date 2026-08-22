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

/** 发送 JSON 请求（支持 POST body 与自定义请求头） */
function httpJson(
  port: number,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { hostname: '127.0.0.1', port, path: pathname, method, headers: { 'Content-Type': 'application/json', ...headers } },
      (res: http.IncomingMessage) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString('utf-8')));
        res.on('end', () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            /* 非 JSON */
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
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

  it('/api 转发：带 server.js 时注册/登录/me 全流程可用', async () => {
    const dir = await makeProjectDir();
    // 注入标准后端运行时（与主工作流注入一致）
    const runtime = path.resolve(__dirname, '..', '..', 'resources', 'app-runtime', 'server.js');
    await fs.copyFile(runtime, path.join(dir, 'server.js'));

    const server = new PreviewServer();
    try {
      const { port } = await server.start(dir);

      const reg = await httpJson(port, 'POST', '/api/register', {
        username: '测试用户',
        password: 'abc123',
      });
      expect(reg.status).toBe(200);
      expect(reg.json.token).toBeTruthy();

      const login = await httpJson(port, 'POST', '/api/login', {
        username: '测试用户',
        password: 'abc123',
      });
      expect(login.status).toBe(200);
      const token = login.json.token as string;

      const me = await httpJson(port, 'GET', '/api/me', undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(me.status).toBe(200);
      expect(me.json.user).toMatchObject({ username: '测试用户' });

      // 静态页面不受影响
      const page = await httpGet(`http://localhost:${port}`);
      expect(page.status).toBe(200);
      expect(page.body).toContain('我的记账本');
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('/api 转发：纯静态项目（无 server.js）返回 503', async () => {
    const dir = await makeProjectDir();
    const server = new PreviewServer();
    try {
      const { port } = await server.start(dir);
      const res = await httpJson(port, 'GET', '/api/health');
      expect(res.status).toBe(503);
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('/api/data 转发：业务数据 CRUD 走后端，按用户隔离', async () => {
    const dir = await makeProjectDir();
    const runtime = path.resolve(__dirname, '..', '..', 'resources', 'app-runtime', 'server.js');
    await fs.copyFile(runtime, path.join(dir, 'server.js'));

    const server = new PreviewServer();
    try {
      const { port } = await server.start(dir);

      // 注册
      const reg = await httpJson(port, 'POST', '/api/register', {
        username: 'tester',
        password: 'abc123',
      });
      expect(reg.status).toBe(200);
      const token = reg.json.token as string;

      // 新建一条数据
      const created = await httpJson(
        port,
        'POST',
        '/api/data/todos',
        { title: '测试任务' },
        { Authorization: `Bearer ${token}` },
      );
      expect(created.status).toBe(200);
      expect(created.json.item.title).toBe('测试任务');
      expect(created.json.item.id).toBeTruthy();

      // 列表
      const list = await httpJson(port, 'GET', '/api/data/todos', undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(list.status).toBe(200);
      expect(list.json.items).toHaveLength(1);

      // 未登录访问数据 → 401
      const anon = await httpJson(port, 'GET', '/api/data/todos');
      expect(anon.status).toBe(401);
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
