import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { ApiHandler } from '../../src/main/preview/server';
import { injectAuthRuntime } from '../../src/main/dev/runtime';

/**
 * 应用后端运行时测试（FreeCoder 登录后端：JWT + 用户存储）。
 * 用生产同款注入器把 server.js（含 sql.js 依赖）写入临时目录后 require，
 * 验证注册/登录/鉴权闭环，数据落在临时目录不污染资源。
 */

const nodeRequire = createRequire(__filename);

async function makeBackend(): Promise<{ dir: string; handleApi: ApiHandler }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-runtime-'));
  await injectAuthRuntime(dir);
  const mod = nodeRequire(path.join(dir, 'server.js')) as { handleApi: ApiHandler };
  return { dir, handleApi: mod.handleApi };
}

function call(
  handleApi: ApiHandler,
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  return handleApi(method, url, body ? JSON.stringify(body) : '', headers ?? {});
}

describe('应用后端运行时（server.js）', () => {
  it('注册 → 登录 → 携带 token 访问 /api/me 的完整闭环', async () => {
    const { handleApi } = await makeBackend();

    const reg = await call(handleApi, 'POST', '/api/register', {
      username: '小明',
      password: 'abc123',
    });
    expect(reg.status).toBe(200);
    expect(reg.body.token).toBeTruthy();
    expect(reg.body.user).toMatchObject({ username: '小明' });
    expect(reg.body.user.passwordHash).toBeUndefined(); // 不泄露密码

    const login = await call(handleApi, 'POST', '/api/login', {
      username: '小明',
      password: 'abc123',
    });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();

    // 错误密码
    const bad = await call(handleApi, 'POST', '/api/login', {
      username: '小明',
      password: 'wrong!',
    });
    expect(bad.status).toBe(401);

    // 无 token → 401
    const anon = await call(handleApi, 'GET', '/api/me');
    expect(anon.status).toBe(401);

    // 有效 token → 200
    const me = await call(handleApi, 'GET', '/api/me', undefined, {
      Authorization: `Bearer ${login.body.token}`,
    });
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('小明');

    // 伪造 token → 401
    const forged = await call(handleApi, 'GET', '/api/me', undefined, {
      Authorization: 'Bearer aaaa.bbbb.cccc',
    });
    expect(forged.status).toBe(401);
  });

  it('用户名重复注册返回 409，参数校验返回 400', async () => {
    const { handleApi } = await makeBackend();

    await call(handleApi, 'POST', '/api/register', { username: 'u1', password: '123456' });
    const dup = await call(handleApi, 'POST', '/api/register', {
      username: 'u1',
      password: '123456',
    });
    expect(dup.status).toBe(409);

    const shortPw = await call(handleApi, 'POST', '/api/register', {
      username: 'u2',
      password: '123',
    });
    expect(shortPw.status).toBe(400);

    const shortName = await call(handleApi, 'POST', '/api/register', {
      username: 'x',
      password: '123456',
    });
    expect(shortName.status).toBe(400);
  });

  it('密码加盐哈希存储：数据文件不含明文密码', async () => {
    const { dir, handleApi } = await makeBackend();
    await call(handleApi, 'POST', '/api/register', { username: 'secret_check_user', password: 'secret123' });

    // 用户存于 SQLite 单文件数据库（data/app.db），users 表含 salt + password_hash
    const dbFile = path.join(dir, 'data', 'app.db');
    const raw = await fs.readFile(dbFile);
    expect(raw.length).toBeGreaterThan(0);
    // 明文密码绝不出现在数据文件中（哈希为 scrypt hex，盐为随机 hex）
    expect(raw.includes('secret123')).toBe(false);
    // 用户确实已落盘（用户名以明文 TEXT 存在）
    expect(raw.includes('secret_check_user')).toBe(true);
  });

  it('健康检查与未知接口', async () => {
    const { handleApi } = await makeBackend();
    const health = await call(handleApi, 'GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const unknown = await call(handleApi, 'GET', '/api/nothing');
    expect(unknown.status).toBe(404);
  });

  it('通用数据集合：CRUD 全流程，按用户隔离', async () => {
    const { handleApi } = await makeBackend();

    // 注册两个用户
    const u1 = await call(handleApi, 'POST', '/api/register', {
      username: 'alice',
      password: 'abc123',
    });
    const u2 = await call(handleApi, 'POST', '/api/register', {
      username: 'bob',
      password: 'abc123',
    });
    const t1 = u1.body.token as string;
    const t2 = u2.body.token as string;

    // 未登录 → 401
    const anon = await call(handleApi, 'GET', '/api/data/todos');
    expect(anon.status).toBe(401);

    // 非法集合名（含特殊字符） → 400
    const bad = await call(handleApi, 'GET', '/api/data/我的%20数据', undefined, {
      Authorization: `Bearer ${t1}`,
    });
    expect(bad.status).toBe(400);

    // 新建
    const created = await call(
      handleApi,
      'POST',
      '/api/data/todos',
      { title: '写代码', done: false },
      { Authorization: `Bearer ${t1}` },
    );
    expect(created.status).toBe(200);
    expect(created.body.item.title).toBe('写代码');
    expect(created.body.item.id).toBeTruthy();
    expect(created.body.item.createdAt).toBeTruthy();
    expect(created.body.item.updatedAt).toBeTruthy();
    const id = created.body.item.id as string;

    // 列表（alice 能看到自己的）
    const list1 = await call(handleApi, 'GET', '/api/data/todos', undefined, {
      Authorization: `Bearer ${t1}`,
    });
    expect(list1.status).toBe(200);
    expect(list1.body.items).toHaveLength(1);
    expect(list1.body.items[0].title).toBe('写代码');

    // bob 看不到 alice 的数据
    const list2 = await call(handleApi, 'GET', '/api/data/todos', undefined, {
      Authorization: `Bearer ${t2}`,
    });
    expect(list2.status).toBe(200);
    expect(list2.body.items).toHaveLength(0);

    // 单条查询
    const one = await call(handleApi, 'GET', `/api/data/todos/${id}`, undefined, {
      Authorization: `Bearer ${t1}`,
    });
    expect(one.status).toBe(200);
    expect(one.body.item.title).toBe('写代码');

    // 更新
    const updated = await call(
      handleApi,
      'PUT',
      `/api/data/todos/${id}`,
      { title: '写代码（已完成）', done: true },
      { Authorization: `Bearer ${t1}` },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.item.title).toBe('写代码（已完成）');
    expect(updated.body.item.done).toBe(true);
    expect(updated.body.item.createdAt).toBe(created.body.item.createdAt); // createdAt 不变
    expect(updated.body.item.updatedAt).not.toBe(created.body.item.updatedAt); // updatedAt 更新

    // 删除
    const removed = await call(handleApi, 'DELETE', `/api/data/todos/${id}`, undefined, {
      Authorization: `Bearer ${t1}`,
    });
    expect(removed.status).toBe(200);
    expect(removed.body.ok).toBe(true);

    // 删除后再查 → 404
    const gone = await call(handleApi, 'GET', `/api/data/todos/${id}`, undefined, {
      Authorization: `Bearer ${t1}`,
    });
    expect(gone.status).toBe(404);
  });

  it('数据按用户隔离持久化到 SQLite：同一文件内按 user_id 区分', async () => {
    const { dir, handleApi } = await makeBackend();
    const reg = await call(handleApi, 'POST', '/api/register', {
      username: 'alice',
      password: 'abc123',
    });
    const token = reg.body.token as string;
    const userId = reg.body.user.id as string;

    await call(handleApi, 'POST', '/api/data/notes', { content: 'hello' }, {
      Authorization: `Bearer ${token}`,
    });

    // 数据持久化在 data/app.db（SQLite 单文件），内容与用户 ID 均落盘
    const dbFile = path.join(dir, 'data', 'app.db');
    const raw = await fs.readFile(dbFile);
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.includes(userId)).toBe(true);
    expect(raw.includes('hello')).toBe(true);
  });
});
