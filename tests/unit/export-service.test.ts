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
      expect(names).toContain('.env.example');
      expect(names).toContain('README.md');
      expect(names).toContain('deploy-guide.html');

      // 内容抽查
      const dockerfile = zip.readAsText('Dockerfile');
      expect(dockerfile).toContain('nginx');
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
