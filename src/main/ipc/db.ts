import { IpcChannels } from '../../shared/types/ipc';
import type {
  DbProvisionParams,
  DbProvisionResult,
} from '../../shared/types/dbprovision';
import { provisionCloudDb } from '../db';
import { CloudDbProvisionError } from '../db/provider';
import { handleIpc, IpcError } from './helpers';

/**
 * 云数据库域 IPC（API 文档 4.7）。
 * db:provision：一键调用云服务商 API 创建数据库并返回连接信息。
 * 云服务商 API Key 仅本次请求使用，不落盘。
 */
export function registerDbIpc(): void {
  handleIpc<DbProvisionParams, DbProvisionResult>(
    IpcChannels.dbProvision,
    async (_event, params) => {
      if (!params?.provider || !params.apiKey?.trim()) {
        throw new IpcError('INVALID_PARAMS', '请选择云数据库服务商并填写 API Key');
      }
      try {
        const db = await provisionCloudDb(params);
        return { success: true, db };
      } catch (err) {
        if (err instanceof CloudDbProvisionError) {
          // 透传服务商侧错误码（API_KEY_INVALID / DB_PROVISION_FAILED / DB_PROVIDER_UNSUPPORTED）
          throw new IpcError(err.code, err.message, err.details);
        }
        throw err;
      }
    },
  );
}
