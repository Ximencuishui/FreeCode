import crypto from 'node:crypto';
import type {
  DbProvisionInfo,
  DbProvisionParams,
} from '../../shared/types/dbprovision';
import { cloudFetchJson } from './http';
import { CloudDbProvisionError, registerProvisioner } from './provider';

/**
 * Supabase（托管 PostgreSQL + 后端服务）一键开通实现。
 * 官方管理 API：https://api.supabase.com/v1
 * - 免费额度 500MB（与 PRD「500MB 云数据库」一致）
 * - 创建项目需先取组织 ID，再 POST /v1/projects（db_pass 由我们生成并带回）
 * - Access Token：https://supabase.com/dashboard/account/tokens（sbp_ 开头）
 */

const SUPABASE_API_BASE = 'https://api.supabase.com/v1';
/** 免费版支持的默认区域 */
const SUPABASE_DEFAULT_REGION = 'us-east-1';

interface SupabaseOrg {
  id: string;
  name: string;
}

interface SupabaseProjectResponse {
  id: string;
  name: string;
  region: string;
  database?: { host?: string; port?: number };
}

/** 生成 URL 安全的数据库密码（16 位字母数字，且至少含一个数字与一个小写字母，满足服务商强度要求） */
function generateDbPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let pw = '';
  for (let i = 0; i < 16; i += 1) {
    pw += chars[crypto.randomInt(chars.length)];
  }
  if (!/[0-9]/.test(pw)) pw = `${pw.slice(0, -1)}${crypto.randomInt(10)}`;
  if (!/[a-z]/.test(pw)) pw = `${pw.slice(0, -1)}a`;
  return pw;
}

/** 项目名规范：小写字母/数字/连字符，去首尾连字符，最长 64（Supabase 项目名约束） */
export function sanitizeProjectName(raw: string | undefined): string {
  const cleaned = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned) return `freecoder-${crypto.randomBytes(3).toString('hex')}`;
  return cleaned.slice(0, 64);
}

export const supabaseProvisioner = {
  provider: 'supabase' as const,

  async provision(params: DbProvisionParams): Promise<DbProvisionInfo> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
      throw new CloudDbProvisionError('API_KEY_INVALID', 'Supabase Access Token 不能为空');
    }
    const name = sanitizeProjectName(params.name);
    const dbPass = generateDbPassword();
    const region = params.region?.trim() || SUPABASE_DEFAULT_REGION;

    // 1) 取账号下的组织（免费版项目必须归属某个组织）
    const orgs = await cloudFetchJson<SupabaseOrg[]>(`${SUPABASE_API_BASE}/organizations`, {}, apiKey);
    const org = orgs?.[0];
    if (!org?.id) {
      throw new CloudDbProvisionError(
        'DB_PROVISION_FAILED',
        'Supabase 账号下没有可用组织，请先在 supabase.com 创建组织',
      );
    }

    // 2) 创建项目（免费计划，秒级返回 project 引用与连接地址）
    const project = await cloudFetchJson<SupabaseProjectResponse>(
      `${SUPABASE_API_BASE}/projects`,
      {
        method: 'POST',
        body: JSON.stringify({
          name,
          organization_id: org.id,
          db_pass: dbPass,
          region,
          plan: 'free',
        }),
      },
      apiKey,
    );

    // 3) 组装连接信息（数据库名与用户固定为 postgres；host 缺失时按项目引用兜底）
    const host = project.database?.host ?? `db.${project.id}.supabase.co`;
    const port = project.database?.port ?? 5432;
    const user = 'postgres';
    const dbName = 'postgres';

    return {
      provider: 'supabase',
      instanceId: project.id,
      host,
      port,
      name: dbName,
      user,
      password: dbPass,
      connectionString: `postgresql://${user}:${dbPass}@${host}:${port}/${dbName}`,
    };
  },
};

registerProvisioner(supabaseProvisioner);
