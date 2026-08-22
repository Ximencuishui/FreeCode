/**
 * 导出域类型（API 文档 4.4）。
 * 含「上线配置向导」收集的 DeployConfig，导出时据此动态生成部署文件。
 */

// ========== 上线配置（DeployConfig） ==========

/** 数据库类型 */
export type DbProvider = 'sqlite' | 'mysql' | 'postgres';

/** 数据库使用方式（仅 mysql / postgres 有效） */
export type DbMode = 'docker' | 'cloud';

export interface DbConfig {
  provider: DbProvider;
  /**
   * - docker：由 docker-compose 内置数据库服务（默认，零外部依赖）
   * - cloud：使用云数据库（需填写连接信息）
   */
  mode?: DbMode;
  /** 云数据库连接信息（mode=cloud 时必填） */
  host?: string;
  port?: number;
  name?: string;
  user?: string;
  password?: string;
}

/** 登录方式（password 始终启用，其余为第三方登录） */
export type LoginMethod = 'password' | 'wechat' | 'douyin' | 'google' | 'github';

/** 第三方登录密钥（在对应开放平台申请） */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface LoginConfig {
  /** 启用的登录方式；password 默认始终包含 */
  methods: LoginMethod[];
  wechat?: OAuthConfig;
  douyin?: OAuthConfig;
  google?: OAuthConfig;
  github?: OAuthConfig;
}

/** 邮箱服务预设（自动带出 SMTP 地址与端口） */
export type EmailPreset = 'qq' | '163' | 'gmail' | 'other';

export interface EmailConfig {
  enabled: boolean;
  preset?: EmailPreset;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  /** SMTP 授权码（部分服务商非邮箱密码） */
  smtpPassword?: string;
  fromName?: string;
}

export interface JwtConfig {
  /** 保持登录天数（默认 7） */
  expiresInDays: number;
}

/** 导出向导收集的完整上线配置 */
export interface DeployConfig {
  db: DbConfig;
  login: LoginConfig;
  email: EmailConfig;
  jwt: JwtConfig;
}

/** 默认上线配置（全部本地、零外部依赖，用户无需填任何东西即可上线） */
export function createDefaultDeployConfig(): DeployConfig {
  return {
    db: { provider: 'sqlite' },
    login: { methods: ['password'] },
    email: { enabled: false },
    jwt: { expiresInDays: 7 },
  };
}

// ========== 导出接口 ==========

export interface ExportStartParams {
  projectId: string;
  includeDocker?: boolean;
  /** 上线配置（缺省时使用默认配置） */
  config?: DeployConfig;
}

export interface ExportStartResult {
  success: boolean;
  exportId?: string;
  error?: string;
}

export interface ExportCompleteEvent {
  exportId: string;
  status: 'success' | 'failed';
  zipPath?: string;
  error?: string;
}
