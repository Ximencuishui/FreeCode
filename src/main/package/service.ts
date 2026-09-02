/**
 * 智能打包服务（v3.2，PRD 2.3 "智能打包" 支柱）。
 *
 * 把用户当前项目代码 + 一个内置的 electron 壳工程 → electron-builder 桌面端安装包（.exe / .dmg / .AppImage）。
 * 不依赖用户的项目类型（纯静态 / 带 server.js 后端均可），统一用 file:// 加载入口 HTML。
 *
 * 流程：
 *  1) preparing       校验项目状态、选择输出目录
 *  2) copying-app     fs.cp 用户代码到临时壳工程的 app/ 子目录
 *  3) rendering-shell 写入 main.js / package.json 到临时壳工程根
 *  4) electron-builder  spawn 本地 node_modules/.bin/electron-builder --project <tmp>
 *  5) finalizing      收尾（清理临时目录 / 广播完成）
 *
 * 产物目录约定：<projectDir>/package/<packageId>/release/，便于用户在文件管理器中查看。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageManager } from '../storage/types';
import { renderShellMain, renderShellPackageJson, type ShellContext } from './shell-template';
import type {
  PackageCompleteEvent,
  PackageProgressEvent,
  PackageStage,
} from '../../shared/types/package';
import { IpcError } from '../ipc/helpers';

export interface PackagerOptions {
  /** 监听进度推送的回调（主进程 IPC 层负责转发到渲染进程） */
  onProgress: (event: PackageProgressEvent) => void;
  /** 监听完成事件的回调（同上） */
  onComplete: (event: PackageCompleteEvent) => void;
  /** 单次任务超时（毫秒），默认 15 分钟（首次打包通常 5-10 分钟） */
  timeoutMs?: number;
}

export class PackagerService {
  /** 当前进行中的子进程（用于取消 / 防止并发） */
  private current: import('node:child_process').ChildProcess | null = null;

  constructor(private readonly storage: StorageManager) {}

  /**
   * 启动一个打包任务。
   * 立刻返回 { packageId }；进度通过 opts.onProgress，完成通过 opts.onComplete 推送。
   */
  async start(
    projectId: string,
    opts: PackagerOptions,
  ): Promise<{ packageId: string }> {
    if (this.current) {
      throw new IpcError('INVALID_PARAMS', '已有打包任务在进行中，请等待完成后再试');
    }
    const project = await this.storage.getProject(projectId);
    if (!project) throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
    if (project.status !== 'ready' && project.status !== 'exported') {
      throw new IpcError('INVALID_PARAMS', '项目尚未开发完成，无法打包');
    }

    const packageId = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, '');

    // 不 await：让上层立刻收到 packageId，开始订阅；后续流程在后台异步跑
    void this.runPipeline(projectId, packageId, project.name, opts);
    return { packageId };
  }

  /** 取消当前任务（仅触发信号，进程退出由 electron-builder 自然结束） */
  cancel(): boolean {
    if (this.current) {
      this.current.kill('SIGTERM');
      return true;
    }
    return false;
  }

  // ============== 流水线 ==============

  private async runPipeline(
    projectId: string,
    packageId: string,
    appName: string,
    opts: PackagerOptions,
  ): Promise<void> {
    const projectDir = this.storage.getProjectDir(projectId);
    const codePath = this.storage.getProjectCodePath(projectId);
    const workRoot = path.join(projectDir, 'package');
    const workDir = path.join(workRoot, packageId);
    const appDir = path.join(workDir, 'app');

    const emit = (stage: PackageStage, message: string, detail?: string) => {
      opts.onProgress({
        packageId,
        stage,
        message,
        ...(detail !== undefined ? { detail } : {}),
      });
    };

    try {
      // 1) preparing
      emit('preparing', '准备打包目录…');
      await fs.mkdir(workDir, { recursive: true });

      // 2) copying-app
      emit('copying-app', '复制应用代码…');
      await fs.cp(codePath, appDir, { recursive: true, force: true });

      // 3) rendering-shell
      emit('rendering-shell', '生成 Electron 壳工程…');
      const entryHtml = await detectEntryHtml(appDir);
      const shellCtx: ShellContext = {
        appName,
        appId: `com.freecoder.${sanitizeId(projectId)}`,
        entryHtml,
        userProjectPath: appDir,
        version: '0.1.0',
      };
      await fs.writeFile(path.join(workDir, 'main.js'), renderShellMain(shellCtx), 'utf-8');
      await fs.writeFile(
        path.join(workDir, 'package.json'),
        renderShellPackageJson(shellCtx),
        'utf-8',
      );

      // 4) electron-builder
      emit('electron-builder', '调用 electron-builder（首次约 5-10 分钟）…');
      const builderResult = await this.spawnBuilder(workDir, packageId, emit, opts.timeoutMs);
      if (builderResult === 'cancelled') {
        opts.onComplete({
          packageId,
          status: 'cancelled',
          error: '用户已取消',
        });
        return;
      }
      if (builderResult !== 'success') {
        opts.onComplete({
          packageId,
          status: 'failed',
          error: 'electron-builder 退出失败，请查看上方日志',
        });
        return;
      }

      // 5) finalizing
      emit('finalizing', '整理产物…');
      const releaseDir = path.join(workDir, 'release');
      const artifact = await pickArtifact(releaseDir);

      opts.onComplete({
        packageId,
        status: 'success',
        outputDir: releaseDir,
        ...(artifact ? { artifactName: artifact } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onComplete({
        packageId,
        status: 'failed',
        error: msg,
      });
    } finally {
      this.current = null;
    }
  }

  /**
   * 在 workDir 里 spawn electron-builder。
   * 返回 'success' | 'failed' | 'cancelled'。
   * electron-builder 输出逐行（按 \n）作为 detail 通过 emit 转发，前端可以做流式日志。
   */
  private spawnBuilder(
    workDir: string,
    packageId: string,
    emit: (stage: PackageStage, message: string, detail?: string) => void,
    timeoutMs = 15 * 60 * 1000,
  ): Promise<'success' | 'failed' | 'cancelled'> {
    return new Promise((resolve) => {
      const builderBin = path.resolve(
        process.cwd(),
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
      );
      const child = spawn(
        builderBin,
        ['--project', workDir, '--publish', 'never'],
        {
          cwd: workDir,
          env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        },
      );
      this.current = child;

      let cancelled = false;
      let buffer = '';
      const onChunk = (buf: Buffer | string) => {
        buffer += buf.toString('utf-8');
        let nl: number;
        // 按行吐日志（electron-builder 输出量大，按行做流式）
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) emit('electron-builder', 'electron-builder', line);
        }
      };
      child.stdout?.on('data', onChunk);
      child.stderr?.on('data', onChunk);

      const timer = setTimeout(() => {
        cancelled = true;
        child.kill('SIGTERM');
        emit('electron-builder', 'electron-builder', `[超时] 已超过 ${Math.round(timeoutMs / 60000)} 分钟，终止打包`);
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        if (this.current === child) this.current = null;
        // spawn 失败（找不到 binary）也算 failed
        emit('electron-builder', 'electron-builder', `[spawn error] ${err.message}`);
        resolve('failed');
      });

      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (this.current === child) this.current = null;
        if (cancelled || signal === 'SIGTERM') {
          resolve('cancelled');
          return;
        }
        if (code === 0) {
          resolve('success');
        } else {
          emit(
            'electron-builder',
            'electron-builder',
            `[exit code=${code ?? 'null'} signal=${signal ?? 'null'}]`,
          );
          resolve('failed');
        }
      });

      // 取消指令触发时（cancel()），kill 子进程；on('exit') 会再次走 cancelled 分支
      void packageId; // 保留供未来扩展：把 cancel 跟具体 packageId 绑定
    });
  }
}

// ============== helpers ==============

/** 从代码目录推断入口 HTML（index.html → app/index.html）。 */
async function detectEntryHtml(appDir: string): Promise<string> {
  const candidates = ['index.html', 'app/index.html', 'public/index.html', 'dist/index.html'];
  for (const rel of candidates) {
    try {
      await fs.access(path.join(appDir, rel));
      return rel;
    } catch {
      // try next
    }
  }
  // 兜底：仍写 index.html，由 electron 启动时报清晰错误给用户
  return 'index.html';
}

/** 把 projectId 转成合法的 appId 片段（保留字母数字与连字符）。 */
function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40) || 'app';
}

/**
 * 在 release/ 目录下找最像"主安装包"的文件：
 *  Windows: *.exe（包含 Setup / Portable）
 *  macOS:   *.dmg
 *  Linux:   *.AppImage
 */
async function pickArtifact(releaseDir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(releaseDir);
  } catch {
    return null;
  }
  const score = (name: string): number => {
    const lower = name.toLowerCase();
    if (process.platform === 'win32') {
      if (lower.endsWith('.exe')) return lower.includes('setup') ? 3 : 2;
      return 0;
    }
    if (process.platform === 'darwin') {
      if (lower.endsWith('.dmg')) return 3;
      if (lower.endsWith('.zip')) return 2;
      return 0;
    }
    if (lower.endsWith('.appimage')) return 3;
    if (lower.endsWith('.deb')) return 2;
    return 0;
  };
  let best: { name: string; score: number } | null = null;
  for (const e of entries) {
    const s = score(e);
    if (s > 0 && (!best || s > best.score)) best = { name: e, score: s };
  }
  return best?.name ?? null;
}