/**
 * 云数据库一键申请服务（主进程）。
 * 依据服务商注册表调用官方 API 自动创建数据库并返回连接信息。
 * 注意：需先引入 neon/supabase 模块以完成注册（见底部注册导入）。
 */
import type {
  DbProvisionInfo,
  DbProvisionParams,
} from '../../shared/types/dbprovision';
import { getProvisioner } from './provider';

// 注册内置服务商（模块副作用：注册到 PROVISIONERS）
import './neon';
import './supabase';

/** 一键申请云数据库：校验参数 → 调用对应服务商 API → 返回连接信息 */
export async function provisionCloudDb(params: DbProvisionParams): Promise<DbProvisionInfo> {
  if (!params?.provider) {
    throw new Error('缺少云数据库服务商');
  }
  if (!params.apiKey?.trim()) {
    throw new Error('API Key 不能为空');
  }
  const provisioner = getProvisioner(params.provider);
  return provisioner.provision(params);
}
