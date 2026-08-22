import type { DeployConfig, DbProvider, LoginMethod } from '../../shared/types/export';

/**
 * 部署配置渲染器（导出服务的地基）。
 * 根据向导收集的 DeployConfig 动态生成：.env / docker-compose.yml / README.md / deploy-guide.html。
 * 纯函数、无 IO，便于单元测试与后续后端应用复用。
 */

/** 渲染所需上下文（敏感值由调用方一次性生成，避免向导重复生成导致不一致） */
export interface RenderContext {
  appName: string;
  /** 对外暴露端口（docker-compose 左侧端口） */
  port: number;
  /** JWT 密钥（自动生成） */
  jwtSecret: string;
  /** 内置 Docker 数据库的密码（自动生成，仅 docker 模式使用） */
  dbPassword: string;
}

export interface RenderedFiles {
  env: string;
  compose: string;
  readme: string;
  guideHtml: string;
}

const DB_DEFAULTS: Record<DbProvider, { name: string; user: string; port: number }> = {
  sqlite: { name: 'freecoder.db', user: '', port: 0 },
  mysql: { name: 'freecoder', user: 'freecoder', port: 3306 },
  postgres: { name: 'freecoder', user: 'freecoder', port: 5432 },
};

const LOGIN_LABELS: Record<string, string> = {
  password: '账号密码登录',
  wechat: '微信登录',
  douyin: '抖音登录',
  google: '谷歌登录',
  github: 'GitHub 登录',
};

/** 清洗环境变量值：去首尾空白、去换行，避免破坏 .env 语法 */
function cleanEnv(value: string | number | undefined): string {
  return String(value ?? '').replace(/[\r\n]/g, '').trim();
}

/** 渲染 .env（含自动生成的密钥，直接可用） */
export function renderEnv(config: DeployConfig, ctx: RenderContext): string {
  const db = config.db;
  const isCloud = db.provider !== 'sqlite' && db.mode === 'cloud';
  const isDockerDb = db.provider !== 'sqlite' && db.mode !== 'cloud';

  const lines: string[] = [
    '# ===== FreeCoder 自动生成的部署配置 =====',
    '# 密钥已自动生成；请妥善保管，勿公开分享。',
    '',
    '# ---------- JWT ----------',
    `JWT_SECRET=${ctx.jwtSecret}`,
    `JWT_EXPIRES_IN=${config.jwt.expiresInDays}d`,
    '',
    '# ---------- 数据库 ----------',
    `DB_PROVIDER=${db.provider}`,
  ];

  if (isCloud) {
    lines.push(
      `DB_HOST=${cleanEnv(db.host)}`,
      `DB_PORT=${db.port ?? DB_DEFAULTS[db.provider].port}`,
      `DB_NAME=${cleanEnv(db.name) || DB_DEFAULTS[db.provider].name}`,
      `DB_USER=${cleanEnv(db.user) || DB_DEFAULTS[db.provider].user}`,
      `DB_PASSWORD=${cleanEnv(db.password)}`,
    );
  } else if (isDockerDb) {
    // 内置 Docker 数据库：应用经 compose 内部网络连接
    lines.push(
      `DB_HOST=db`,
      `DB_PORT=${DB_DEFAULTS[db.provider].port}`,
      `DB_NAME=${DB_DEFAULTS[db.provider].name}`,
      `DB_USER=${DB_DEFAULTS[db.provider].user}`,
      `DB_PASSWORD=${ctx.dbPassword}`,
    );
  } else {
    lines.push('# SQLite：数据库文件由应用自动创建并持久化，无需任何配置');
  }

  lines.push('', '# ---------- 登录方式 ----------');
  const methods: LoginMethod[] = config.login.methods.length ? config.login.methods : ['password'];
  lines.push(`LOGIN_METHODS=${methods.join(',')}`);
  for (const method of methods) {
    if (method === 'password') continue;
    const oauth = config.login[method];
    if (oauth?.clientId || oauth?.clientSecret) {
      lines.push(
        `${method.toUpperCase()}_CLIENT_ID=${cleanEnv(oauth.clientId)}`,
        `${method.toUpperCase()}_CLIENT_SECRET=${cleanEnv(oauth.clientSecret)}`,
      );
    }
  }

  lines.push('', '# ---------- 邮箱（SMTP） ----------');
  if (config.email.enabled) {
    lines.push(
      `SMTP_ENABLED=true`,
      `SMTP_HOST=${cleanEnv(config.email.smtpHost)}`,
      `SMTP_PORT=${config.email.smtpPort ?? 465}`,
      `SMTP_USER=${cleanEnv(config.email.smtpUser)}`,
      `SMTP_PASSWORD=${cleanEnv(config.email.smtpPassword)}`,
      `SMTP_FROM_NAME=${cleanEnv(config.email.fromName) || ctx.appName}`,
    );
  } else {
    lines.push('SMTP_ENABLED=false', '# 未启用邮箱。如需验证码/找回密码，请重新导出并开启邮箱');
  }

  return `${lines.join('\n')}\n`;
}

/** 渲染 docker-compose.yml（按配置决定是否内置数据库服务） */
export function renderCompose(config: DeployConfig, ctx: RenderContext): string {
  const db = config.db;
  const needsDbService = db.provider !== 'sqlite' && db.mode !== 'cloud';

  const lines: string[] = [
    'services:',
    '  app:',
    '    build: .',
    '    container_name: freecoder-app',
    '    ports:',
    `      - "${ctx.port}:80"`,
  ];

  if (needsDbService) {
    lines.push('    depends_on:', '      db:', '        condition: service_healthy');
  }
  if (db.provider === 'sqlite') {
    lines.push('', '    volumes:', '      - ./data:/app/data');
  }

  lines.push('    restart: unless-stopped');

  if (needsDbService) {
    const image = db.provider === 'mysql' ? 'mysql:8.0' : 'postgres:16-alpine';
    const dataDir = db.provider === 'mysql' ? '/var/lib/mysql' : '/var/lib/postgresql/data';
    const healthcheck =
      db.provider === 'mysql'
        ? ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-u', 'root']
        : ['CMD-SHELL', "pg_isready -U freecoder -d freecoder"];
    lines.push(
      '',
      '  db:',
      `    image: ${image}`,
      '    container_name: freecoder-db',
      '    environment:',
      ...(db.provider === 'mysql'
        ? [
            `      MYSQL_ROOT_PASSWORD: ${ctx.dbPassword}`,
            `      MYSQL_DATABASE: ${DB_DEFAULTS.mysql.name}`,
            `      MYSQL_USER: ${DB_DEFAULTS.mysql.user}`,
            `      MYSQL_PASSWORD: ${ctx.dbPassword}`,
          ]
        : [
            `      POSTGRES_DB: ${DB_DEFAULTS.postgres.name}`,
            `      POSTGRES_USER: ${DB_DEFAULTS.postgres.user}`,
            `      POSTGRES_PASSWORD: ${ctx.dbPassword}`,
          ]),
      '    volumes:',
      `      - db-data:${dataDir}`,
      '    healthcheck:',
      `      test: ${JSON.stringify(healthcheck)}`,
      '      interval: 5s',
      '      timeout: 5s',
      '      retries: 10',
      '    restart: unless-stopped',
      '',
      'volumes:',
      '  db-data:',
    );
  }

  return `${lines.join('\n')}\n`;
}

/** 数据库人类可读描述 */
function describeDb(config: DeployConfig): string {
  const db = config.db;
  if (db.provider === 'sqlite') return '本地文件数据库（SQLite，自动创建，零配置）';
  if (db.mode === 'cloud') {
    const port = db.port ?? DB_DEFAULTS[db.provider].port;
    const host = cleanEnv(db.host) || '（未填写）';
    return `云数据库 ${db.provider}（${host}:${port}）`;
  }
  return `${db.provider === 'mysql' ? 'MySQL 8' : 'PostgreSQL 16'}（docker-compose 内置，开箱即用）`;
}

/** 渲染中文部署指引 README（按配置动态生成） */
export function renderReadme(appName: string, config: DeployConfig, ctx: RenderContext): string {
  const lines: string[] = [
    `# ${appName} 部署说明`,
    '',
    '您的应用已准备好上线！以下配置已自动生成，无需手动填写：',
    '',
    '## 已自动配置的项目',
    `- **数据库**：${describeDb(config)}`,
    `- **登录方式**：${config.login.methods.map((m) => LOGIN_LABELS[m] ?? m).join('、')}`,
    config.email.enabled
      ? `- **邮箱**：已启用（SMTP：${cleanEnv(config.email.smtpHost)}）`
      : '- **邮箱**：未启用（不影响上线，如需验证码/找回密码可后续补充）',
    `- **登录保持**：${config.jwt.expiresInDays} 天`,
    `- **JWT 密钥**：已自动生成（见 .env 中 JWT_SECRET）`,
    '',
    '## 第 1 步：购买服务器',
    '- 推荐：阿里云 / 腾讯云，最低配置 2核2GB',
    '- 操作系统：Ubuntu 22.04',
    '',
    '## 第 2 步：上传部署包',
    '- 将本文件夹上传到服务器 /home/ubuntu/ 目录',
    '- 重命名文件夹为 freecoder-deploy（可选）',
    '',
    '## 第 3 步：运行应用',
    '```bash',
    'cd /home/ubuntu/freecoder-deploy',
    'docker-compose up -d',
    '```',
    '',
    '## 第 4 步：访问您的应用',
    `- 在浏览器输入：http://您的服务器IP:${ctx.port}`,
    '- 恭喜！您的应用已上线！',
    '',
    '## 常见问题',
    `- 端口被占用：修改 docker-compose.yml 中 ports 左侧的端口号，然后重新执行 docker-compose up -d`,
    config.db.provider === 'sqlite'
      ? '- 数据不会丢失：应用数据保存在 data/ 目录（本地数据库），随部署包持久化'
      : config.db.mode === 'cloud'
        ? '- 云数据库连接失败：请检查 .env 中 DB_* 是否正确，以及云数据库是否允许您的服务器 IP 访问'
        : '- 数据库连接失败：首次启动会初始化数据库，等待约 10 秒后刷新页面即可',
    config.login.methods.length > 1
      ? '- 第三方登录失效：请检查 .env 中对应 CLIENT_ID / CLIENT_SECRET，并确认已配置回调地址'
      : '',
    config.email.enabled
      ? '- 邮件发送失败：SMTP 授权码须在邮箱设置中单独开启，且与邮箱密码不同'
      : '',
    '',
    '💡 如需帮助，请访问 FreeCoder 社区论坛',
    '',
  ].filter((l) => l !== '');

  return `${lines.join('\n')}\n`;
}

/** 渲染图文部署指南（HTML，按配置动态生成） */
export function renderGuideHtml(appName: string, config: DeployConfig, ctx: RenderContext): string {
  const dbLine =
    config.db.provider === 'sqlite'
      ? '本地文件数据库（SQLite，自动创建，零配置）'
      : config.db.mode === 'cloud'
        ? `云数据库 ${config.db.provider}（已按您填写的连接信息配置）`
        : `${config.db.provider === 'mysql' ? 'MySQL 8' : 'PostgreSQL 16'}（docker-compose 内置）`;
  const loginLine = config.login.methods.map((m) => LOGIN_LABELS[m] ?? m).join('、');
  const emailLine = config.email.enabled ? '已启用' : '未启用（可后续补充）';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${appName} 部署指南</title>
<style>
body{font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1A2B3C;line-height:1.7}
h1{border-bottom:2px solid #4A90D9;padding-bottom:10px}
.step{background:#F8F9FA;border-radius:12px;padding:16px 20px;margin:12px 0}
.step h2{color:#4A90D9;font-size:18px;margin:0 0 8px}
pre{background:#1A2B3C;color:#E8ECF0;padding:12px 16px;border-radius:8px;overflow-x:auto}
table{border-collapse:collapse;width:100%;margin:8px 0}
td,th{border:1px solid #DCE3EA;padding:8px 12px;text-align:left;font-size:14px}
th{background:#F0F4F8}
</style>
</head>
<body>
<h1>📖 ${appName} 部署指南</h1>
<p>您的部署包已包含以下自动配置，无需手动填写：</p>
<table>
<tr><th>项目</th><th>您的配置</th></tr>
<tr><td>数据库</td><td>${dbLine}</td></tr>
<tr><td>登录方式</td><td>${loginLine}</td></tr>
<tr><td>邮箱</td><td>${emailLine}</td></tr>
<tr><td>登录保持</td><td>${config.jwt.expiresInDays} 天</td></tr>
<tr><td>JWT 密钥</td><td>已自动生成（.env 中 JWT_SECRET）</td></tr>
</table>
<div class="step"><h2>第 1 步：购买服务器</h2><p>推荐阿里云/腾讯云，最低配置 <b>2核2GB</b>，操作系统 <b>Ubuntu 22.04</b>。</p></div>
<div class="step"><h2>第 2 步：上传部署包</h2><p>将本文件夹上传到服务器 <code>/home/ubuntu/</code> 目录。</p></div>
<div class="step"><h2>第 3 步：运行应用</h2><pre>cd /home/ubuntu/freecoder-deploy
docker-compose up -d</pre></div>
<div class="step"><h2>第 4 步：访问应用</h2><p>浏览器输入 <code>http://您的服务器IP:${ctx.port}</code>，您的应用已上线！🎉</p></div>
</body>
</html>
`;
}

/** 一次性渲染全部部署文件 */
export function renderDeployFiles(config: DeployConfig, ctx: RenderContext): RenderedFiles {
  return {
    env: renderEnv(config, ctx),
    compose: renderCompose(config, ctx),
    readme: renderReadme(ctx.appName, config, ctx),
    guideHtml: renderGuideHtml(ctx.appName, config, ctx),
  };
}
