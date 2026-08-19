import { IpcChannels } from '../../shared/types/ipc';
import type {
  ProjectListResult,
  ProjectCreateParams,
  ProjectCreateResult,
  ProjectDeleteParams,
  ProjectDeleteResult,
  ProjectGetParams,
  ProjectGetResult,
} from '../../shared/types/project';
import type { StorageManager } from '../storage/types';
import { handleIpc, IpcError } from './helpers';

/** 项目管理域 IPC（API 文档 4.3），基于本地存储实现 */
export function registerProjectIpc(storage: StorageManager): void {
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
}
