import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { IpcChannels } from '../../shared/types/ipc';
import type {
  ProjectListResult,
  ProjectCreateParams,
  ProjectCreateResult,
  ProjectDeleteParams,
  ProjectDeleteResult,
  ProjectGetParams,
  ProjectGetResult,
  ProjectConfirmParams,
  ProjectConfirmResult,
  ProjectConfirmPlanParams,
  ProjectConfirmPlanResult,
  ProjectSelectLocationResult,
} from '../../shared/types/project';
import type { SignalEvent } from '../../shared/types/chat';
import type { StorageManager } from '../storage/types';
import type { Developer } from '../dev/developer';
import type { VersionPlanner } from '../dev/planner';
import { handleIpc, IpcError } from './helpers';

/** 向所有窗口推送 chat:signal 事件 */
function broadcastSignal(signal: SignalEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.chatSignal, signal);
  }
}

/** 项目管理域 IPC（API 文档 4.3），基于本地存储实现 */
export function registerProjectIpc(
  storage: StorageManager,
  developer: Developer,
  planner: VersionPlanner,
): void {
  handleIpc<undefined, ProjectListResult>(IpcChannels.projectList, async () => {
    const metas = await storage.listProjects();
    return {
      projects: metas.map((m) => ({
        id: m.id,
        name: m.name,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        status: m.status,
      })),
    };
  });

  handleIpc<ProjectCreateParams, ProjectCreateResult>(
    IpcChannels.projectCreate,
    async (_event, params) => {
      if (!params?.name?.trim()) {
        throw new IpcError('PROJECT_NAME_EMPTY', '项目名称不能为空');
      }
      const meta = await storage.createProject(params.name.trim(), {
        description: params.description,
        template: params.template,
        location: params.location,
      });
      return {
        success: true,
        projectId: meta.id,
        projectPath: storage.getProjectDir(meta.id),
      };
    },
  );

  // 选择项目保存位置（系统文件夹选择器）。用户可取消，取消后由渲染层走"跳过"逻辑
  handleIpc<undefined, ProjectSelectLocationResult>(
    IpcChannels.projectSelectLocation,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options: OpenDialogOptions = {
        title: '选择项目保存位置',
        defaultPath: storage.getDefaultProjectsDir(),
        buttonLabel: '保存到此位置',
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, canceled: true };
      }
      return { success: true, canceled: false, path: result.filePaths[0] };
    },
  );

  handleIpc<ProjectDeleteParams, ProjectDeleteResult>(
    IpcChannels.projectDelete,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      if (params.confirm !== true) {
        throw new IpcError('INVALID_PARAMS', '删除项目需要二次确认');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      await storage.deleteProject(params.projectId);
      return { success: true };
    },
  );

  handleIpc<ProjectGetParams, ProjectGetResult>(IpcChannels.projectGet, async (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    const meta = await storage.getProject(params.projectId);
    if (!meta) {
      throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
    }
    const requirements = await storage.getRequirements(params.projectId);
    const history = await storage.getChatHistory(params.projectId, 50);
    return {
      success: true,
      project: {
        id: meta.id,
        name: meta.name,
        description: meta.description ?? '',
        requirements: {
          goal: requirements?.goal ?? '',
          targetUsers: requirements?.targetUsers ?? '',
          coreFeatures: requirements?.coreFeatures ?? [],
          visualStyle: requirements?.visualStyle ?? '',
        },
        versionPlan: meta.versionPlan ?? null,
        status: meta.status,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        chatHistory: history,
        codePath: storage.getProjectCodePath(meta.id),
      },
    };
  });

  // 确认需求 → 进入版本分段阶段（planned），后台生成版本计划（写代码前的 MVP 切分）
  handleIpc<ProjectConfirmParams, ProjectConfirmResult>(
    IpcChannels.projectConfirm,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      const requirements = await storage.getRequirements(params.projectId);
      if (!requirements || (!requirements.goal && requirements.coreFeatures.length === 0)) {
        throw new IpcError('INVALID_PARAMS', '需求尚未生成，请先完成需求对话');
      }
      // 幂等保护：已进入版本分段（或后续阶段）时不重复生成计划
      if (project.status !== 'draft') {
        return { success: true };
      }

      await storage.confirmRequirements(params.projectId);
      await storage.updateProjectMeta(params.projectId, { status: 'planned' });

      // 后台生成版本分段计划，完成时推送信号（渲染端刷新计划卡片）
      void planner
        .generatePlan(params.projectId, (outcome) => {
          broadcastSignal({
            type: outcome.success ? 'info' : 'error',
            message: outcome.message,
            timestamp: new Date().toISOString(),
          });
        })
        .catch(() => undefined);

      return { success: true };
    },
  );

  // 确认版本分段计划（可携带用户调整后的计划）→ 启动开发
  handleIpc<ProjectConfirmPlanParams, ProjectConfirmPlanResult>(
    IpcChannels.projectConfirmPlan,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      const plan = params.plan ?? project.versionPlan;
      if (!plan || plan.versions.length === 0) {
        throw new IpcError('INVALID_PARAMS', '版本分段计划尚未生成，请稍候');
      }
      // 结构校验：V1 必须含版本标签与至少一个功能，避免非法计划导致静默回退为全量开发
      const v1 = plan.versions[0];
      if (
        !v1 ||
        typeof v1.label !== 'string' ||
        !v1.label.trim() ||
        !Array.isArray(v1.features) ||
        v1.features.length === 0
      ) {
        throw new IpcError('INVALID_PARAMS', '版本分段计划无效：请至少保留 1 个 V1 功能');
      }

      await storage.updateProjectMeta(params.projectId, {
        versionPlan: plan,
        status: 'developing',
      });

      // 后台执行开发（只开发 V1/MVP），完成时推送信号
      void developer.startDevelopment(params.projectId, (outcome) => {
        broadcastSignal({
          type: outcome.success ? 'info' : 'error',
          message: outcome.message,
          timestamp: new Date().toISOString(),
        });
      });

      return { success: true };
    },
  );
}
