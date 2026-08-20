import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { StorageManager } from '../storage/types';
import type { ExportOptions } from '../storage/types';
import { IpcError } from '../ipc/helpers';

/**
 * 导出部署包服务（数据库文档 3.6 / 7.3、PRD 2.3）。
 * 生成内容：项目源码 + Dockerfile + docker-compose.yml + .env.example + 中文部署指引。
 */

export interface ExportResult {
  exportId: string;
  zipPath: string;
  exportCount: number;
}

function timestampId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

/** 生成 Dockerfile（静态 Web 应用 + nginx） */
function buildDockerfile(): string {
  return `# FreeCoder 生成 - 静态 Web 应用镜像
FROM nginx:alpine

# 将应用代码复制到 nginx 站点目录
COPY app/ /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
`;
}

/** 生成 docker-compose.yml */
function buildCompose(port: number): string {
  return `version: "3"

services:
  app:
    build: .
    container_name: freecoder-app
    ports:
      - "${port}:80"
    restart: unless-stopped
`;
}

function buildEnvExample(): string {
  return `# 环境变量示例
# 应用监听端口（与 docker-compose.yml 中的端口映射一致）
APP_PORT=3000
`;
}

/** 生成中文部署指引 README（PRD 2.3.3 示例风格） */
function buildReadme(appName: string): string {
  return `# ${appName} 部署说明

您的应用已准备好上线！请按以下步骤操作：

## 第 1 步：购买服务器
- 推荐：阿里云 / 腾讯云，最低配置 2核2GB
- 操作系统：Ubuntu 22.04

## 第 2 步：上传部署包
- 将本文件夹上传到服务器 /home/ubuntu/ 目录
- 重命名文件夹为 freecoder-deploy（可选）

## 第 3 步：运行应用
\`\`\`bash
cd /home/ubuntu/freecoder-deploy
docker-compose up -d
\`\`\`

## 第 4 步：访问您的应用
- 在浏览器输入：http://您的服务器IP:3000
- 恭喜！您的应用已上线！

## 常见问题
- 端口被占用：修改 docker-compose.yml 中 ports 左侧的端口号，然后重新执行 docker-compose up -d
- 数据不会丢失：应用数据保存在浏览器 localStorage（用户设备本地）

💡 如需帮助，请访问 FreeCoder 社区论坛
`;
}

/** 生成图文部署指南（HTML） */
function buildGuideHtml(appName: string): string {
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
code{background:#E8ECF0;padding:2px 6px;border-radius:4px;font-size:14px}
pre{background:#1A2B3C;color:#E8ECF0;padding:12px 16px;border-radius:8px;overflow-x:auto}
</style>
</head>
<body>
<h1>📖 ${appName} 部署指南</h1>
<div class="step"><h2>第 1 步：购买服务器</h2><p>推荐阿里云/腾讯云，最低配置 <b>2核2GB</b>，操作系统 <b>Ubuntu 22.04</b>。</p></div>
<div class="step"><h2>第 2 步：上传部署包</h2><p>将本文件夹上传到服务器 <code>/home/ubuntu/</code> 目录。</p></div>
<div class="step"><h2>第 3 步：运行应用</h2><pre>cd /home/ubuntu/freecoder-deploy
docker-compose up -d</pre></div>
<div class="step"><h2>第 4 步：访问应用</h2><p>浏览器输入 <code>http://您的服务器IP:3000</code>，您的应用已上线！🎉</p></div>
</body>
</html>
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

      // 2. 生成部署配置文件
      if (includeDocker) {
        await fs.writeFile(path.join(tmpDir, 'Dockerfile'), buildDockerfile(), 'utf-8');
        await fs.writeFile(path.join(tmpDir, 'docker-compose.yml'), buildCompose(3000), 'utf-8');
        await fs.writeFile(path.join(tmpDir, '.env.example'), buildEnvExample(), 'utf-8');
      }
      await fs.writeFile(path.join(tmpDir, 'README.md'), buildReadme(project.name), 'utf-8');
      await fs.writeFile(path.join(tmpDir, 'deploy-guide.html'), buildGuideHtml(project.name), 'utf-8');

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
