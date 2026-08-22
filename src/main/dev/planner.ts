import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import { buildVersionPlanTask } from '../dsh/prompt';
import { tryParseVersionPlan, fallbackVersionPlan } from '../dsh/structured';

export interface VersionPlannerDeps {
  storage: StorageManager;
  dsh: Pick<DSHService, 'runTask'>;
}

export interface PlanOutcome {
  projectId: string;
  success: boolean;
  message: string;
}

/**
 * 版本分段规划器：需求确认后、写代码前，由 AI 把功能切分为 V1（MVP）与后续版本。
 * 非技术用户容易追求大而全，此阶段引导用户先做最小可用版本。
 * 状态流转：draft → planned（计划生成，待用户确认）→ developing（确认计划后）。
 * DSH 失败或未返回有效 JSON 时使用确定性兜底计划（V1=首个核心功能），保证流程不中断。
 */
export class VersionPlanner {
  constructor(private readonly deps: VersionPlannerDeps) {}

  /** 生成版本分段计划（后台执行，完成后经 onDone 回调通知） */
  async generatePlan(projectId: string, onDone: (outcome: PlanOutcome) => void): Promise<void> {
    // 整体兜底：任何存储/解析异常都确保 onDone 必被回调一次，避免渲染端轮询无终止
    try {
      const storage = this.deps.storage;

      await storage.updateProjectMeta(projectId, { status: 'planned' });

      const requirements = await storage.getRequirements(projectId);
      if (!requirements || requirements.coreFeatures.length === 0) {
        onDone({ projectId, success: false, message: '需求尚未就绪，无法生成版本计划' });
        return;
      }

      // AI 切分建议；失败或无效时兜底（V1=第一个核心功能）
      let plan = null;
      try {
        const result = await this.deps.dsh.runTask(
          storage.getProjectCodePath(projectId),
          buildVersionPlanTask(requirements),
        );
        if (result.exitCode === 0) {
          plan = tryParseVersionPlan(result.reply);
        }
      } catch {
        /* 使用兜底计划 */
      }
      if (!plan) {
        plan = fallbackVersionPlan(requirements.coreFeatures);
      }

      await storage.updateProjectMeta(projectId, { versionPlan: plan });
      onDone({
        projectId,
        success: true,
        message: '版本分段计划已生成：先做最小可用版本（V1），确认后开始开发',
      });
    } catch {
      onDone({ projectId, success: false, message: '版本分段计划生成失败，请稍后重试' });
    }
  }
}
