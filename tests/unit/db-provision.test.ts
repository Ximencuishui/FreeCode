/** @jest-environment node */
/**
 * 云数据库一键申请单元测试：
 * - Neon / Supabase 成功路径（mock fetch）：请求构造、响应解析、连接信息回填
 * - 失败路径：401 → API_KEY_INVALID、网络错误 → DB_PROVISION_FAILED、未知服务商 → DB_PROVIDER_UNSUPPORTED
 * - IPC 层参数校验（db:provision）
 */
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  BrowserWindow: { getAllWindows: jest.fn(() => []) },
}));

import { ipcMain } from 'electron';
import { IpcChannels } from '../../src/shared/types/ipc';
import { provisionCloudDb } from '../../src/main/db';
import { sanitizeDbName } from '../../src/main/db/neon';
import { sanitizeProjectName } from '../../src/main/db/supabase';
import { registerDbIpc } from '../../src/main/ipc/db';

/** 构造 mock Response */
function mockFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** 取注册到 ipcMain 的（已包装错误转换的）处理器 */
function getHandler(channel: string): (event: unknown, params: unknown) => Promise<unknown> {
  const call = (ipcMain.handle as jest.Mock).mock.calls.find((c) => c[0] === channel);
  expect(call).toBeDefined();
  return call![1] as (event: unknown, params: unknown) => Promise<unknown>;
}

const fetchMock = jest.fn();

describe('云数据库一键申请', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe('Neon', () => {
    it('成功创建：解析 connection_uris 返回连接信息', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(201, {
          project: { id: 'project-123' },
          connection_uris: [
            {
              connection_uri:
                'postgres://alex:secret123@ep-cool.us-east-2.aws.neon.tech/mydb?sslmode=require',
              connection_parameters: {
                database: 'mydb',
                host: 'ep-cool.us-east-2.aws.neon.tech',
                password: 'secret123',
                port: 5432,
                user: 'alex',
                ssl: true,
              },
            },
          ],
        }),
      );

      const result = await provisionCloudDb({ provider: 'neon', apiKey: 'napi_test_key' });

      expect(result).toMatchObject({
        provider: 'neon',
        instanceId: 'project-123',
        host: 'ep-cool.us-east-2.aws.neon.tech',
        port: 5432,
        name: 'mydb',
        user: 'alex',
        password: 'secret123',
      });
      expect(result.connectionString).toContain('postgres://');

      // 请求构造校验
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://console.neon.tech/api/v2/projects');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer napi_test_key');
      const body = JSON.parse(init.body);
      expect(body.connection_uris).toBe(true);
      expect(body.project.roles[0].name).toBeTruthy();
      expect(body.project.databases[0].owner_name).toBe(body.project.roles[0].name);
      expect(body.project.region_id).toBe('aws-us-east-2');
    });

    it('缺省数据库名时自动生成合法名称', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(201, {
          project: { id: 'p2' },
          connection_uris: [
            {
              connection_uri: 'postgres://u:p@ep-x.us-east-2.aws.neon.tech/db1',
              connection_parameters: {
                host: 'ep-x',
                port: 5432,
                user: 'u',
                password: 'p',
                database: 'db1',
              },
            },
          ],
        }),
      );

      const result = await provisionCloudDb({ provider: 'neon', apiKey: 'napi_abc' });
      expect(result.name).toBe('db1');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.project.roles[0].name).toMatch(/^freecoder_[0-9a-f]{6}$/);
    });

    it('项目名仅用连字符（下划线替换为 -），角色名保留下划线', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(201, {
          project: { id: 'p4' },
          connection_uris: [
            {
              connection_uri: 'postgres://u:p@ep-x:5432/my_db',
              connection_parameters: {
                host: 'ep-x',
                port: 5432,
                user: 'u',
                password: 'p',
                database: 'my_db',
              },
            },
          ],
        }),
      );

      await provisionCloudDb({ provider: 'neon', apiKey: 'napi_abc', name: 'my_db' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.project.name).toBe('freecoder-my-db');
      expect(body.project.roles[0].name).toBe('my_db');
    });

    it('connection_parameters 缺失时从连接串解析', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(201, {
          project: { id: 'p3' },
          connection_uris: [
            {
              connection_uri:
                'postgres://alice:pw123@ep-fallback.us-west-2.aws.neon.tech/appdb',
            },
          ],
        }),
      );

      const result = await provisionCloudDb({ provider: 'neon', apiKey: 'napi_abc' });
      expect(result.host).toBe('ep-fallback.us-west-2.aws.neon.tech');
      expect(result.port).toBe(5432);
      expect(result.user).toBe('alice');
      expect(result.password).toBe('pw123');
      expect(result.name).toBe('appdb');
    });

    it('401 时映射为 API_KEY_INVALID', async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse(401, { message: 'Unauthorized' }));
      await expect(provisionCloudDb({ provider: 'neon', apiKey: 'napi_bad' })).rejects.toMatchObject(
        { code: 'API_KEY_INVALID' },
      );
    });

    it('网络异常映射为 DB_PROVISION_FAILED', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(provisionCloudDb({ provider: 'neon', apiKey: 'napi_abc' })).rejects.toMatchObject(
        { code: 'DB_PROVISION_FAILED' },
      );
    });

    it('响应缺少 connection_uris 时映射为 DB_PROVISION_FAILED', async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse(201, { project: { id: 'p-empty' } }));
      await expect(provisionCloudDb({ provider: 'neon', apiKey: 'napi_abc' })).rejects.toMatchObject(
        { code: 'DB_PROVISION_FAILED' },
      );
    });
  });

  describe('sanitizeDbName', () => {
    it('转小写、替换非法字符、去首尾下划线', () => {
      expect(sanitizeDbName('My-DB Name!')).toBe('my_db_name');
      expect(sanitizeDbName('')).toMatch(/^freecoder_[0-9a-f]{6}$/);
      expect(sanitizeDbName(undefined)).toMatch(/^freecoder_[0-9a-f]{6}$/);
      expect(sanitizeDbName('a'.repeat(100))).toHaveLength(63);
    });

    it('数字开头时自动加 freecoder_ 前缀（Neon 角色名不允许数字开头）', () => {
      expect(sanitizeDbName('123db')).toBe('freecoder_123db');
    });
  });

  describe('sanitizeProjectName', () => {
    it('清洗非法字符为连字符、转小写、去首尾连字符', () => {
      expect(sanitizeProjectName('My Project!')).toBe('my-project');
      expect(sanitizeProjectName('---abc---')).toBe('abc');
      expect(sanitizeProjectName('')).toMatch(/^freecoder-[0-9a-f]{6}$/);
      expect(sanitizeProjectName(undefined)).toMatch(/^freecoder-[0-9a-f]{6}$/);
      expect(sanitizeProjectName('a'.repeat(100))).toHaveLength(64);
    });
  });

  describe('Supabase', () => {
    it('成功创建：取组织 + 建项目，返回 postgres 连接信息', async () => {
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(200, [{ id: 'org-1', name: 'My Org' }]))
        .mockResolvedValueOnce(
          mockFetchResponse(201, {
            id: 'abcdefghij',
            name: 'freecoder-xyz',
            region: 'us-east-1',
            database: { host: 'db.abcdefghij.supabase.co', port: 5432 },
          }),
        );

      const result = await provisionCloudDb({ provider: 'supabase', apiKey: 'sbp_token' });

      expect(result).toMatchObject({
        provider: 'supabase',
        instanceId: 'abcdefghij',
        host: 'db.abcdefghij.supabase.co',
        port: 5432,
        user: 'postgres',
        name: 'postgres',
      });
      expect(result.password).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(result.password).toMatch(/[0-9]/); // 至少含一个数字
      expect(result.password).toMatch(/[a-z]/); // 至少含一个小写字母
      expect(result.connectionString).toBe(
        `postgresql://postgres:${result.password}@db.abcdefghij.supabase.co:5432/postgres`,
      );

      const [orgUrl, orgInit] = fetchMock.mock.calls[0];
      expect(orgUrl).toBe('https://api.supabase.com/v1/organizations');
      expect(orgInit.headers.Authorization).toBe('Bearer sbp_token');

      const [projUrl, projInit] = fetchMock.mock.calls[1];
      expect(projUrl).toBe('https://api.supabase.com/v1/projects');
      const projBody = JSON.parse(projInit.body);
      expect(projBody).toMatchObject({
        organization_id: 'org-1',
        plan: 'free',
        region: 'us-east-1',
      });
      expect(projBody.db_pass).toMatch(/^[A-Za-z0-9]{16}$/);
    });

    it('host 缺失时按项目引用兜底', async () => {
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(200, [{ id: 'org-1', name: 'O' }]))
        .mockResolvedValueOnce(mockFetchResponse(201, { id: 'ref12345678' }));

      const result = await provisionCloudDb({ provider: 'supabase', apiKey: 'sbp_token' });
      expect(result.host).toBe('db.ref12345678.supabase.co');
      expect(result.port).toBe(5432);
    });

    it('无组织时报错', async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse(200, []));
      await expect(
        provisionCloudDb({ provider: 'supabase', apiKey: 'sbp_token' }),
      ).rejects.toMatchObject({ code: 'DB_PROVISION_FAILED' });
    });

    it('创建项目被服务商拒绝时映射为 DB_PROVISION_FAILED', async () => {
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(200, [{ id: 'org-1', name: 'O' }]))
        .mockResolvedValueOnce(mockFetchResponse(400, { message: 'region not supported' }));
      await expect(
        provisionCloudDb({ provider: 'supabase', apiKey: 'sbp_token', region: 'ap-south-1' }),
      ).rejects.toMatchObject({ code: 'DB_PROVISION_FAILED' });
    });
  });

  describe('注册表与 IPC', () => {
    it('未注册服务商抛出 DB_PROVIDER_UNSUPPORTED', async () => {
      await expect(
        provisionCloudDb({ provider: 'tencent' as never, apiKey: 'x' }),
      ).rejects.toMatchObject({ code: 'DB_PROVIDER_UNSUPPORTED' });
    });

    it('db:provision 参数校验：缺 API Key 返回 INVALID_PARAMS', async () => {
      registerDbIpc();
      const handler = getHandler(IpcChannels.dbProvision);
      const result = await handler({}, { provider: 'neon', apiKey: '' });
      expect(result).toMatchObject({ success: false, error: { code: 'INVALID_PARAMS' } });
    });

    it('db:provision 成功路径透传连接信息', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(201, {
          project: { id: 'p-ipc' },
          connection_uris: [
            {
              connection_uri: 'postgres://u:p@ep-ipc.us-east-2.aws.neon.tech/db',
              connection_parameters: {
                host: 'ep-ipc',
                port: 5432,
                user: 'u',
                password: 'p',
                database: 'db',
              },
            },
          ],
        }),
      );
      registerDbIpc();
      const handler = getHandler(IpcChannels.dbProvision);
      const result = (await handler({}, { provider: 'neon', apiKey: 'napi_ok' })) as {
        success: boolean;
        db?: { host: string };
      };
      expect(result.success).toBe(true);
      expect(result.db?.host).toBe('ep-ipc');
    });
  });
});
