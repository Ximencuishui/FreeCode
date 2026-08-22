import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import { buildDevelopmentTask } from '../dsh/prompt';
import { injectAuthRuntime } from './runtime';

export interface DeveloperDeps {
  storage: StorageManager;
  dsh: Pick<DSHService, 'runTask'>;
}

export interface DevelopmentOutcome {
  projectId: string;
  success: boolean;
  message: string;
  durationMs: number;
}

/**
 * 开发执行器（WP-12）：版本计划确认后，调用 DSH 在项目代码目录生成应用。
 * 状态流转：planned → developing → ready（成功）或保持 developing（失败，可重试）。
 * 有版本计划时只开发 V1（MVP）功能子集，避免一次性堆砌全部功能。
 */
export class Developer {
  constructor(private readonly deps: DeveloperDeps) {}

  /** 启动开发任务（后台执行，不阻塞调用方；完成后经 onDone 回调通知） */
  async startDevelopment(
    projectId: string,
    onDone: (outcome: DevelopmentOutcome) => void,
  ): Promise<void> {
    const storage = this.deps.storage;
    const started = Date.now();

    await storage.updateProjectMeta(projectId, { status: 'developing' });

    const requirements = await storage.getRequirements(projectId);
    const meta = await storage.getProject(projectId);
    const task = buildDevelopmentTask(requirements, meta?.versionPlan ?? null);
    const codePath = storage.getProjectCodePath(projectId);

    const result = await this.deps.dsh.runTask(codePath, task);
    const durationMs = Date.now() - started;

    if (result.exitCode === 0) {
      // 注入标准登录运行时（JWT 后端 + 前端 SDK），失败静默不影响开发成功
      await injectAuthRuntime(codePath);
      await storage.updateProjectMeta(projectId, { status: 'ready' });
      onDone({
        projectId,
        success: true,
        message: '开发完成！您的应用已就绪，可以预览了',
        durationMs,
      });
    } else {
      onDone({
        projectId,
        success: false,
        message: '开发遇到一点小状况，请稍后重试',
        durationMs,
      });
    }
  }
}
