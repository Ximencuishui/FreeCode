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
import { handleIpc, IpcError } from './helpers';

/**
 * 项目管理域 IPC（API 文档 4.3）。
 * WP-03 桩实现：列表返回空数组，其余返回 NOT_IMPLEMENTED；业务逻辑在 WP-04（存储模块）落地。
 */
export function registerProjectIpc(): void {
  handleIpc<undefined, ProjectListResult>(IpcChannels.projectList, () => ({
    projects: [],
  }));

  handleIpc<ProjectCreateParams, ProjectCreateResult>(IpcChannels.projectCreate, (_event, params) => {
    if (!params?.name?.trim()) {
      throw new IpcError('PROJECT_NAME_EMPTY', '项目名称不能为空');
    }
    throw new IpcError('NOT_IMPLEMENTED', '项目创建将在后续版本提供');
  });

  handleIpc<ProjectDeleteParams, ProjectDeleteResult>(IpcChannels.projectDelete, (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    if (params.confirm !== true) {
      throw new IpcError('INVALID_PARAMS', '删除项目需要二次确认');
    }
    throw new IpcError('NOT_IMPLEMENTED', '项目删除将在后续版本提供');
  });

  handleIpc<ProjectGetParams, ProjectGetResult>(IpcChannels.projectGet, (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    throw new IpcError('NOT_IMPLEMENTED', '项目详情将在后续版本提供');
  });
}
