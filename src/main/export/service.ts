import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import type { StorageManager } from '../storage/types';
import type { ExportOptions } from '../storage/types';
import { createDefaultDeployConfig } from '../../shared/types/export';
import type { DeployConfig } from '../../shared/types/export';
import { renderDeployFiles } from './config-renderer';
import { IpcError } from '../ipc/helpers';

/**
 * 导出部署包服务（数据库文档 3.6 / 7.3、PRD 2.3）。
 * 生成内容：项目源码 + Dockerfile + docker-compose.yml + .env + 中文部署指引。
 * 部署文件按向导收集的 DeployConfig 动态生成（见 config-renderer.ts）。
 */

export interface ExportResult {
  exportId: string;
  zipPath: string;
  exportCount: number;
}

function timestampId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

/** 生成 Dockerfile（带后端应用：Node 运行 server.js，含静态托管与 API） */
function buildNodeDockerfile(): string {
  return `# FreeCoder 生成 - 带后端应用镜像
FROM node:20-alpine

WORKDIR /app

# 安装依赖（sql.js 等）
COPY app/package.json /app/package.json
RUN npm install --omit=dev --ignore-scripts 2>/dev/null || true

# 应用代码（含 server.js 后端与静态页面）
COPY app/ /app/
# 部署配置（JWT 密钥等，已自动生成）
COPY .env /app/.env

EXPOSE 80

CMD ["node", "server.js"]
`;
}

/** 生成 Dockerfile（纯静态应用 + nginx，回退方案） */
function buildStaticDockerfile(): string {
  return `# FreeCoder 生成 - 静态 Web 应用镜像
FROM nginx:alpine

# 将应用代码复制到 nginx 站点目录
COPY app/ /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
`;
}

/** 导出部署包服务 */
export class ExportService {
  constructor(private readonly storage: StorageManager) {}

  /** 导出项目为部署包 zip，返回 zip 路径 */
  async exportProject(projectId: string, options: ExportOptions = {}): Promise<ExportResult> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
    }

    const includeDocker = options.includeDocker ?? true;
    const config: DeployConfig = options.config ?? createDefaultDeployConfig();
    const exportId = timestampId();
    const codePath = this.storage.getProjectCodePath(projectId);
    const projectDir = this.storage.getProjectDir(projectId);
    const exportsDir = path.join(projectDir, 'exports');
    const tmpRoot = path.join(projectDir, '..', '..', 'tmp');
    const tmpDir = path.join(tmpRoot, `export-${exportId}`);

    try {
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.mkdir(exportsDir, { recursive: true });

      // 1. 复制项目代码到 app/
      const appDir = path.join(tmpDir, 'app');
      await fs.cp(codePath, appDir, { recursive: true, force: true });

      // 2. 生成部署配置文件（密钥一次性生成，保证 .env 与 docker-compose 一致）
      const rendered = renderDeployFiles(config, {
        appName: project.name,
        port: 3000,
        jwtSecret: crypto.randomBytes(32).toString('hex'),
        dbPassword: crypto.randomBytes(16).toString('hex'),
      });

      if (includeDocker) {
        // 有 server.js（后端运行时）→ Node 镜像；否则回退 nginx 静态镜像
        const hasBackend = await fs
          .access(path.join(appDir, 'server.js'))
          .then(() => true)
          .catch(() => false);
        const dockerfile = hasBackend ? buildNodeDockerfile() : buildStaticDockerfile();
        await fs.writeFile(path.join(tmpDir, 'Dockerfile'), dockerfile, 'utf-8');
        await fs.writeFile(path.join(tmpDir, 'docker-compose.yml'), rendered.compose, 'utf-8');
        await fs.writeFile(path.join(tmpDir, '.env'), rendered.env, 'utf-8');
      }
      await fs.writeFile(path.join(tmpDir, 'README.md'), rendered.readme, 'utf-8');
      await fs.writeFile(path.join(tmpDir, 'deploy-guide.html'), rendered.guideHtml, 'utf-8');

      // 3. 打包 zip
      const zipPath = path.join(exportsDir, `${exportId}.zip`);
      this.zipDirectory(tmpDir, zipPath);

      // 4. 更新导出计数
      await this.storage.updateProjectMeta(projectId, {
        exportCount: project.exportCount + 1,
        status: 'exported',
      });

      return { exportId, zipPath, exportCount: project.exportCount + 1 };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  /** 将目录内容打包为 zip（条目位于 zip 根） */
  private zipDirectory(sourceDir: string, zipPath: string): void {
    const zip = new AdmZip();
    zip.addLocalFolder(sourceDir);
    zip.writeZip(zipPath);
  }
}
