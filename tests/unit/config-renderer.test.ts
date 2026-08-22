import {
  renderEnv,
  renderCompose,
  renderReadme,
  renderGuideHtml,
  type RenderContext,
} from '../../src/main/export/config-renderer';
import { createDefaultDeployConfig } from '../../src/shared/types/export';
import type { DeployConfig } from '../../src/shared/types/export';

/**
 * 部署配置渲染器测试（地基：动态生成 .env / docker-compose / 部署指引）。
 */

const CTX: RenderContext = {
  appName: '测试应用',
  port: 3000,
  jwtSecret: 'a'.repeat(64),
  dbPassword: 'b'.repeat(32),
};

describe('renderEnv', () => {
  it('默认配置：本地数据库 + 密码登录 + 未启用邮箱 + 自动生成 JWT 密钥', () => {
    const env = renderEnv(createDefaultDeployConfig(), CTX);
    expect(env).toContain(`JWT_SECRET=${CTX.jwtSecret}`);
    expect(env).toContain('JWT_EXPIRES_IN=7d');
    expect(env).toContain('DB_PROVIDER=sqlite');
    expect(env).toContain('LOGIN_METHODS=password');
    expect(env).toContain('SMTP_ENABLED=false');
  });

  it('云数据库（mysql）：写入连接信息与默认端口', () => {
    const config: DeployConfig = {
      ...createDefaultDeployConfig(),
      db: { provider: 'mysql', mode: 'cloud', host: 'rm-abc.mysql.rds.example.com', user: 'root', password: 'pwd' },
    };
    const env = renderEnv(config, CTX);
    expect(env).toContain('DB_PROVIDER=mysql');
    expect(env).toContain('DB_HOST=rm-abc.mysql.rds.example.com');
    expect(env).toContain('DB_PORT=3306');
    expect(env).toContain('DB_NAME=freecoder');
    expect(env).toContain('DB_USER=root');
    expect(env).toContain('DB_PASSWORD=pwd');
  });

  it('内置数据库（postgres）：连接指向 compose 内部 db 服务', () => {
    const config: DeployConfig = {
      ...createDefaultDeployConfig(),
      db: { provider: 'postgres', mode: 'docker' },
    };
    const env = renderEnv(config, CTX);
    expect(env).toContain('DB_HOST=db');
    expect(env).toContain('DB_PORT=5432');
    expect(env).toContain(`DB_PASSWORD=${CTX.dbPassword}`);
  });

  it('第三方登录 + 邮箱：写入密钥与 SMTP 信息，未勾选的不出现', () => {
    const config: DeployConfig = {
      db: { provider: 'sqlite' },
      login: {
        methods: ['password', 'wechat', 'github'],
        wechat: { clientId: 'wx-id', clientSecret: 'wx-secret' },
        github: { clientId: 'gh-id', clientSecret: 'gh-secret' },
      },
      email: {
        enabled: true,
        preset: 'qq',
        smtpHost: 'smtp.qq.com',
        smtpPort: 465,
        smtpUser: 'me@qq.com',
        smtpPassword: 'auth-code',
      },
      jwt: { expiresInDays: 30 },
    };
    const env = renderEnv(config, CTX);
    expect(env).toContain('LOGIN_METHODS=password,wechat,github');
    expect(env).toContain('WECHAT_CLIENT_ID=wx-id');
    expect(env).toContain('WECHAT_CLIENT_SECRET=wx-secret');
    expect(env).toContain('GITHUB_CLIENT_ID=gh-id');
    expect(env).not.toContain('GOOGLE_');
    expect(env).toContain('SMTP_ENABLED=true');
    expect(env).toContain('SMTP_HOST=smtp.qq.com');
    expect(env).toContain('SMTP_PORT=465');
    expect(env).toContain('SMTP_USER=me@qq.com');
    expect(env).toContain('SMTP_PASSWORD=auth-code');
    expect(env).toContain('JWT_EXPIRES_IN=30d');
  });

  it('清洗用户输入中的换行，避免破坏 .env 语法', () => {
    const config: DeployConfig = {
      ...createDefaultDeployConfig(),
      db: { provider: 'mysql', mode: 'cloud', host: 'bad\nhost', password: 'p\nw' },
    };
    const env = renderEnv(config, CTX);
    expect(env).toContain('DB_HOST=badhost');
    expect(env).not.toContain('bad\nhost');
    expect(env).toContain('DB_PASSWORD=pw');
    expect(env).not.toContain('p\nw');
  });
});

describe('renderCompose', () => {
  it('默认 sqlite：单服务 + 数据卷，无数据库服务', () => {
    const compose = renderCompose(createDefaultDeployConfig(), CTX);
    expect(compose).toContain('container_name: freecoder-app');
    expect(compose).toContain('./data:/app/data');
    expect(compose).not.toContain('container_name: freecoder-db');
    expect(compose).not.toContain('db-data:');
  });

  it('mysql 内置：增加 db 服务、健康检查与数据卷', () => {
    const config: DeployConfig = {
      ...createDefaultDeployConfig(),
      db: { provider: 'mysql', mode: 'docker' },
    };
    const compose = renderCompose(config, CTX);
    expect(compose).toContain('image: mysql:8.0');
    expect(compose).toContain('container_name: freecoder-db');
    expect(compose).toContain('condition: service_healthy');
    expect(compose).toContain('db-data:/var/lib/mysql');
    expect(compose).toContain(`MYSQL_PASSWORD: ${CTX.dbPassword}`);
  });

  it('云数据库：不生成数据库服务', () => {
    const config: DeployConfig = {
      ...createDefaultDeployConfig(),
      db: { provider: 'postgres', mode: 'cloud', host: 'pg.example.com' },
    };
    const compose = renderCompose(config, CTX);
    expect(compose).not.toContain('container_name: freecoder-db');
    expect(compose).not.toContain('db-data:');
  });
});

describe('renderReadme / renderGuideHtml', () => {
  it('按配置生成摘要：数据库、登录、邮箱、登录保持', () => {
    const config: DeployConfig = {
      db: { provider: 'postgres', mode: 'cloud', host: 'pg.example.com' },
      login: { methods: ['password', 'github'], github: { clientId: 'x', clientSecret: 'y' } },
      email: { enabled: true, smtpHost: 'smtp.qq.com' },
      jwt: { expiresInDays: 90 },
    };
    const readme = renderReadme('测试应用', config, CTX);
    expect(readme).toContain('测试应用');
    expect(readme).toContain('云数据库 postgres（pg.example.com');
    expect(readme).toContain('账号密码登录、GitHub 登录');
    expect(readme).toContain('已启用（SMTP：smtp.qq.com）');
    expect(readme).toContain('90 天');
    expect(readme).toContain('docker-compose up -d');

    const html = renderGuideHtml('测试应用', config, CTX);
    expect(html).toContain('测试应用');
    expect(html).toContain('云数据库 postgres');
    expect(html).toContain('90 天');
  });

  it('默认配置：README 说明本地零配置，不出现云数据库提示', () => {
    const readme = renderReadme('测试应用', createDefaultDeployConfig(), CTX);
    expect(readme).toContain('本地文件数据库（SQLite');
    expect(readme).not.toContain('云数据库');
    expect(readme).toContain('未启用（不影响上线');
  });
});
