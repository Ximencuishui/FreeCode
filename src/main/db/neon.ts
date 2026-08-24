import crypto from 'node:crypto';
import type {
  DbProvisionInfo,
  DbProvisionParams,
} from '../../shared/types/dbprovision';
import { cloudFetchJson } from './http';
import { CloudDbProvisionError, registerProvisioner } from './provider';

/**
 * Neon（serverless PostgreSQL）一键开通实现。
 * 官方 API：POST https://console.neon.tech/api/v2/projects
 * - 免费额度 0.5GB 存储（与 PRD「500MB 云数据库」一致）
 * - 创建项目时指定角色与数据库并开启 connection_uris，响应直接带回连接信息（秒级）
 * - API Key：https://console.neon.tech/account/api-keys（napi_ 开头）
 */

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
/** 默认区域（未指定时使用；免费额度内可选 us-west-2 / ap-southeast-1 等） */
const NEON_DEFAULT_REGION = 'aws-us-east-2';
/** Neon 项目名最长 64 字符 */
const NEON_NAME_MAX = 64;

/** 角色/数据库名规范：仅小写字母数字下划线、不以数字开头、最长 63 字符（Neon 要求） */
export function sanitizeDbName(raw: string | undefined): string {
  let cleaned = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return `freecoder_${crypto.randomBytes(3).toString('hex')}`;
  if (/^[0-9]/.test(cleaned)) cleaned = `freecoder_${cleaned}`;
  return cleaned.slice(0, 63);
}

interface NeonConnectionUrisResponse {
  project: { id: string };
  connection_uris?: {
    connection_uri?: string;
    connection_parameters?: {
      database?: string;
      host?: string;
      password?: string;
      port?: number;
      user?: string;
    };
  }[];
}

/** 从连接串解析连接参数（connection_parameters 缺失时的兜底） */
function parseConnectionUri(uri: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
} {
  try {
    const url = new URL(uri);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      name: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  } catch {
    throw new CloudDbProvisionError('DB_PROVISION_FAILED', 'Neon 返回的连接串格式异常');
  }
}

export const neonProvisioner = {
  provider: 'neon' as const,

  async provision(params: DbProvisionParams): Promise<DbProvisionInfo> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
      throw new CloudDbProvisionError('API_KEY_INVALID', 'Neon API Key 不能为空');
    }
    const dbName = sanitizeDbName(params.name);
    // 项目名仅使用小写字母/数字/连字符（Neon 项目名约束），下划线替换为连字符
    const projectName = `freecoder-${dbName.replace(/_/g, '-')}`.slice(0, NEON_NAME_MAX);

    const body: Record<string, unknown> = {
      project: {
        name: projectName,
        pg_version: 16,
        // 不传密码时 Neon 自动生成，并在 connection_uris 中带回
        roles: [{ name: dbName }],
        databases: [{ name: dbName, owner_name: dbName }],
      },
      connection_uris: true,
    };
    if (params.region?.trim()) {
      (body.project as Record<string, unknown>).region_id = params.region.trim();
    } else {
      (body.project as Record<string, unknown>).region_id = NEON_DEFAULT_REGION;
    }

    const data = await cloudFetchJson<NeonConnectionUrisResponse>(
      `${NEON_API_BASE}/projects`,
      { method: 'POST', body: JSON.stringify(body) },
      apiKey,
    );

    const conn = data.connection_uris?.[0];
    const params0 = conn?.connection_parameters;
    const uriParts = conn?.connection_uri ? parseConnectionUri(conn.connection_uri) : undefined;

    const host = params0?.host ?? uriParts?.host;
    const user = params0?.user ?? uriParts?.user;
    const password = params0?.password ?? uriParts?.password;
    const name = params0?.database ?? uriParts?.name ?? dbName;
    const port = params0?.port ?? uriParts?.port ?? 5432;

    if (!host || !user || !password) {
      throw new CloudDbProvisionError(
        'DB_PROVISION_FAILED',
        'Neon 响应缺少连接信息，请稍后重试或检查 API Key 权限',
      );
    }

    return {
      provider: 'neon',
      instanceId: data.project.id,
      host,
      port,
      name,
      user,
      password,
      connectionString: conn?.connection_uri ?? `postgres://${user}:${password}@${host}:${port}/${name}`,
    };
  },
};

registerProvisioner(neonProvisioner);
