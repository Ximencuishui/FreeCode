import { BrowserWindow } from 'electron';
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
} from '../../shared/types/project';
import type { SignalEvent } from '../../shared/types/chat';
import type { StorageManager } from '../storage/types';
import type { Developer } from '../dev/developer';
import { handleIpc, IpcError } from './helpers';

/** 向所有窗口推送 chat:signal 事件 */
function broadcastSignal(signal: SignalEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.chatSignal, signal);
  }
}

/** 项目管理域 IPC（API 文档 4.3），基于本地存储实现 */
export function registerProjectIpc(storage: StorageManager, developer: Developer): void {
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
      });
      return {
        success: true,
        projectId: meta.id,
        projectPath: storage.getProjectDir(meta.id),
      };
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
        status: meta.status,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        chatHistory: history,
        codePath: storage.getProjectCodePath(meta.id),
      },
    };
  });

  // 确认需求并启动开发（内部扩展通道，API 文档未列）
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

      await storage.confirmRequirements(params.projectId);
      await storage.updateProjectMeta(params.projectId, { status: 'developing' });

      // 后台执行开发，完成时推送信号
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
