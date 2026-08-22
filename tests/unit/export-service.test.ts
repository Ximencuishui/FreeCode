import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { FileStorageManager } from '../../src/main/storage';
import { plainEncryptor } from '../../src/main/security/encryption';
import { ExportService } from '../../src/main/export/service';
import type { ProjectMeta } from '../../src/main/storage/types';

/**
 * 导出部署包测试（数据库文档 3.6 zip 结构）。
 */

async function makeStorage(): Promise<{ storage: FileStorageManager; dir: string; meta: ProjectMeta }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-export-'));
  const storage = new FileStorageManager(dir, plainEncryptor);
  await storage.init();
  const meta = await storage.createProject('测试应用');
  // 写入模拟代码
  const codeDir = storage.getProjectCodePath(meta.id);
  await fs.writeFile(path.join(codeDir, 'index.html'), '<h1>测试应用</h1>', 'utf-8');
  await fs.writeFile(path.join(codeDir, 'style.css'), 'h1{color:red}', 'utf-8');
  // 状态 ready 才可导出
  await storage.updateProjectMeta(meta.id, { status: 'ready' });
  return { storage, dir, meta };
}

describe('导出部署包', () => {
  it('导出生成 zip：包含源码与部署配置', async () => {
    const { storage, dir, meta } = await makeStorage();
    try {
      const exporter = new ExportService(storage);
      const result = await exporter.exportProject(meta.id);

      expect(result.zipPath).toMatch(/\.zip$/);
      expect(result.exportCount).toBe(1);
      await expect(fs.access(result.zipPath)).resolves.toBeUndefined();

      // 解压验证内容
      const zip = new AdmZip(result.zipPath);
      const entries = zip.getEntries().map((e) => e.entryName);
      const names = entries.join('\n');
      expect(names).toContain('app/index.html');
      expect(names).toContain('app/style.css');
      expect(names).toContain('Dockerfile');
      expect(names).toContain('docker-compose.yml');
      expect(names).toContain('.env');
      expect(names).toContain('README.md');
      expect(names).toContain('deploy-guide.html');

      // 内容抽查
      const dockerfile = zip.readAsText('Dockerfile');
      expect(dockerfile).toContain('nginx');
      const env = zip.readAsText('.env');
      expect(env).toContain('DB_PROVIDER=sqlite');
      expect(env).toContain('JWT_SECRET=');
      expect(env).toContain('LOGIN_METHODS=password');
      const readme = zip.readAsText('README.md');
      expect(readme).toContain('测试应用');
      expect(readme).toContain('docker-compose up -d');

      // meta 更新
      const metaAfter = await storage.getProject(meta.id);
      expect(metaAfter?.status).toBe('exported');
      expect(metaAfter?.exportCount).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('按上线配置导出：内置数据库 + 第三方登录 + 邮箱写入 .env 与 docker-compose', async () => {
    const { storage, dir, meta } = await makeStorage();
    try {
      const exporter = new ExportService(storage);
      const result = await exporter.exportProject(meta.id, {
        config: {
          db: { provider: 'mysql', mode: 'docker' },
          login: {
            methods: ['password', 'github'],
            github: { clientId: 'gh-id', clientSecret: 'gh-secret' },
          },
          email: { enabled: true, smtpHost: 'smtp.qq.com', smtpUser: 'me@qq.com', smtpPassword: 'code' },
          jwt: { expiresInDays: 30 },
        },
      });

      const zip = new AdmZip(result.zipPath);
      const env = zip.readAsText('.env');
      const compose = zip.readAsText('docker-compose.yml');

      expect(env).toContain('DB_PROVIDER=mysql');
      expect(env).toContain('DB_HOST=db');
      expect(env).toContain('GITHUB_CLIENT_ID=gh-id');
      expect(env).toContain('GITHUB_CLIENT_SECRET=gh-secret');
      expect(env).toContain('SMTP_ENABLED=true');
      expect(env).toContain('SMTP_HOST=smtp.qq.com');
      expect(env).toContain('JWT_EXPIRES_IN=30d');
      expect(compose).toContain('image: mysql:8.0');
      expect(compose).toContain('container_name: freecoder-db');
      expect(compose).toContain('condition: service_healthy');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('带后端（server.js）导出：Dockerfile 使用 Node 镜像运行登录后端', async () => {
    const { storage, dir, meta } = await makeStorage();
    try {
      const runtime = path.resolve(__dirname, '..', '..', 'resources', 'app-runtime', 'server.js');
      await fs.copyFile(runtime, path.join(storage.getProjectCodePath(meta.id), 'server.js'));

      const exporter = new ExportService(storage);
      const result = await exporter.exportProject(meta.id);
      const zip = new AdmZip(result.zipPath);
      const dockerfile = zip.readAsText('Dockerfile');
      expect(dockerfile).toContain('node:20-alpine');
      expect(dockerfile).toContain('CMD ["node", "server.js"]');
      expect(zip.readAsText('.env')).toContain('JWT_SECRET=');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('导出后临时目录被清理', async () => {
    const { storage, dir, meta } = await makeStorage();
    try {
      const exporter = new ExportService(storage);
      await exporter.exportProject(meta.id);
      // tmp 目录（root/tmp）应不存在或为空
      const tmpDir = path.join(dir, 'tmp');
      const entries = await fs.readdir(tmpDir).catch(() => []);
      expect(entries.filter((e) => e.startsWith('export-'))).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
