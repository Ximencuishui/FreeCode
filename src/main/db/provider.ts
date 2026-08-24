import type {
  CloudDbProvider,
  DbProvisionInfo,
  DbProvisionParams,
} from '../../shared/types/dbprovision';
import type { ErrorCode } from '../../shared/types/ipc';

/**
 * 云数据库服务商抽象（可插拔）：
 * 新增服务商只需实现 CloudDbProvisioner 并注册到 REGISTRY，
 * 无需改动 IPC / 前端。当前内置 Neon、Supabase。
 */
export interface CloudDbProvisioner {
  /** 服务商标识 */
  readonly provider: CloudDbProvider;
  /** 调用官方 API 一键创建数据库并返回连接信息 */
  provision(params: DbProvisionParams): Promise<DbProvisionInfo>;
}

/** 云数据库开通异常：携带统一业务错误码（供 IPC 层透传） */
export class CloudDbProvisionError extends Error {
  constructor(
    public readonly code: Extract<ErrorCode, 'API_KEY_INVALID' | 'DB_PROVISION_FAILED' | 'DB_PROVIDER_UNSUPPORTED'>,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CloudDbProvisionError';
  }
}

/** 服务商注册表 */
export const PROVISIONERS = new Map<CloudDbProvider, CloudDbProvisioner>();

/** 注册服务商（模块加载时调用） */
export function registerProvisioner(provisioner: CloudDbProvisioner): void {
  PROVISIONERS.set(provisioner.provider, provisioner);
}

/** 获取已注册的服务商，未注册时抛出 DB_PROVIDER_UNSUPPORTED */
export function getProvisioner(provider: CloudDbProvider): CloudDbProvisioner {
  const provisioner = PROVISIONERS.get(provider);
  if (!provisioner) {
    throw new CloudDbProvisionError(
      'DB_PROVIDER_UNSUPPORTED',
      `暂不支持该云数据库服务商：${provider}`,
    );
  }
  return provisioner;
}
