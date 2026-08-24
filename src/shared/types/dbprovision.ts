/**
 * 云数据库一键申请域类型。
 * 主进程通过云服务商官方 API（Neon / Supabase）自动创建数据库实例并返回连接信息，
 * 免去用户手动购买、填表的步骤。对应 API 文档 4.7「数据库接口」。
 */

/** 已支持的云数据库服务商（架构上可插拔，新增服务商只需实现 Provider 并注册） */
export type CloudDbProvider = 'neon' | 'supabase';

/** 一键申请云数据库参数（渲染进程 → 主进程） */
export interface DbProvisionParams {
  /** 云服务商 */
  provider: CloudDbProvider;
  /** 云服务商 API Key（Neon: napi_…；Supabase: sbp_…；不落盘，仅本次请求使用） */
  apiKey: string;
  /** 数据库名（可选，缺省自动生成；仅小写字母/数字/下划线） */
  name?: string;
  /** 云区域 ID（可选，缺省使用服务商默认区域） */
  region?: string;
}

/** 申请成功后返回的连接信息（仅创建时返回一次完整信息） */
export interface DbProvisionInfo {
  /** 云服务商 */
  provider: CloudDbProvider;
  /** 服务商侧项目/实例 ID（便于后续管理与排障） */
  instanceId: string;
  /** 连接主机 */
  host: string;
  /** 端口 */
  port: number;
  /** 数据库名 */
  name: string;
  /** 用户名 */
  user: string;
  /** 数据库密码（仅创建时返回，之后由服务商托管） */
  password: string;
  /** 完整连接串（可直接用于后端 .env 的 DB_HOST 等拆分或整体使用） */
  connectionString: string;
}

/** db:provision 返回值（统一错误契约见 API 文档 5.3） */
export type DbProvisionResult =
  | { success: true; db: DbProvisionInfo }
  | { success: false; error: { code: string; message: string; details?: unknown } };

/** 云服务商展示元信息（渲染层使用） */
export interface CloudDbProviderMeta {
  provider: CloudDbProvider;
  label: string;
  desc: string;
  /** 免费额度说明 */
  quota: string;
  /** API Key 名称 */
  keyLabel: string;
  /** API Key 输入框占位 */
  keyPlaceholder: string;
  /** 获取 API Key 的官方地址（一键跳转） */
  keyUrl: string;
  /** 可选的推荐区域列表（label + regionId） */
  regions: { label: string; regionId: string }[];
}
