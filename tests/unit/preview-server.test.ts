import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import { PreviewServer, findAvailablePort } from '../../src/main/preview/server';
import { injectAuthRuntime } from '../../src/main/dev/runtime';

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
    // 占用 3000（若已被其他进程占用，如应用预览服务，则跳过 blocker——服务器同样应跳到 3001）
    const blocker = net.createServer();
    let blocked = false;
    try {
      await new Promise<void>((resolve, reject) => {
        blocker.once('error', reject);
        blocker.listen(3000, '127.0.0.1', resolve);
      });
      blocked = true;
    } catch {
      /* 3000 已被占用：无需 blocker */
    }

    const dir = await makeProjectDir();
    const server = new PreviewServer();
    try {
      const info = await server.start(dir);
      expect(info.port).toBe(3001);
    } finally {
      await server.stop();
      if (blocked) blocker.close();
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

  it('后端毒化自愈：API 抛错后重载 server.js 自动恢复（修复预览 500 打不开）', async () => {
    // 模拟项目 server.js 的 dbReady 被初始化失败毒化：模块加载时读标记文件，
    // 标记存在则该实例所有调用抛错（与 sql.js OOM 后 dbReady 永久 rejected 行为一致）
    const dir = await makeProjectDir();
    await fs.writeFile(
      path.join(dir, 'server.js'),
      [
        `'use strict';`,
        `const fs = require('fs');`,
        `const path = require('path');`,
        `const poisoned = fs.existsSync(path.join(__dirname, 'poisoned.flag'));`,
        `module.exports = {`,
        `  handleApi: async function () {`,
        `    if (poisoned) throw new Error('模拟后端初始化失败（毒化实例）');`,
        `    return { status: 200, body: { ok: true } };`,
        `  },`,
        `};`,
      ].join('\n'),
      'utf-8',
    );
    await fs.writeFile(path.join(dir, 'poisoned.flag'), 'x', 'utf-8');
    const server = new PreviewServer();
    try {
      const { port } = await server.start(dir);
      // 第一次调用：毒化实例抛错 → 触发重载重试，重载后仍毒化 → 500（携带真实错误）
      const first = await httpJson(port, 'GET', '/api/health');
      expect(first.status).toBe(500);
      expect(JSON.stringify(first.json)).toContain('毒化实例');

      // 移除毒化标记 → 下一次调用触发重载成功，自动恢复
      await fs.rm(path.join(dir, 'poisoned.flag'));
      const second = await httpJson(port, 'GET', '/api/health');
      expect(second.status).toBe(200);
      expect(second.json.ok).toBe(true);
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('后端加载失败：/api 返回 503 且携带真实错误信息（不静默吞错）', async () => {
    const dir = await makeProjectDir();
    // 语法错误的 server.js：require 阶段即抛错
    await fs.writeFile(path.join(dir, 'server.js'), 'this is not valid js !!!', 'utf-8');
    const server = new PreviewServer();
    try {
      const { port } = await server.start(dir);
      const res = await httpJson(port, 'GET', '/api/health');
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.json)).toContain('后端尚未就绪');
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
    await injectAuthRuntime(dir);

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
    await injectAuthRuntime(dir);

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
