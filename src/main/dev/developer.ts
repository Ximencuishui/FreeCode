import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import { buildDevelopmentTask } from '../dsh/prompt';

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
 * 开发执行器（WP-12）：需求确认后，调用 DSH 在项目代码目录生成完整应用。
 * 状态流转：draft → developing → ready（成功）或保持 developing（失败，可重试）。
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
    const task = buildDevelopmentTask(requirements);
    const codePath = storage.getProjectCodePath(projectId);

    const result = await this.deps.dsh.runTask(codePath, task);
    const durationMs = Date.now() - started;

    if (result.exitCode === 0) {
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
