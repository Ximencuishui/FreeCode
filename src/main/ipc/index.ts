import { registerAppIpc } from './app';
import { registerChatIpc } from './chat';
import { registerProjectIpc } from './project';
import { registerPreviewIpc } from './preview';
import { registerExportIpc } from './export';
import { registerPackageIpc } from './package';
import { registerSettingsIpc } from './settings';
import { registerApiKeyIpc } from './apikey';
import { registerDbIpc } from './db';
import { registerDshIpc } from './dsh';
import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import type { Developer } from '../dev/developer';
import type { VersionPlanner } from '../dev/planner';
import type { LLMClient } from '../llm/client';

/** 注册全部 IPC 处理器，见 API 文档第七章接口清单 */
export function registerIpcHandlers(
  storage: StorageManager,
  dsh: DSHService,
  developer: Developer,
  planner: VersionPlanner,
  llmClient: LLMClient,
): void {
  registerAppIpc();
  registerChatIpc(storage, dsh);
  registerProjectIpc(storage, dsh, developer, planner, llmClient);
  registerPreviewIpc(storage);
  registerExportIpc(storage);
  registerPackageIpc(storage);
  registerSettingsIpc(storage);
  registerApiKeyIpc(storage);
  registerDbIpc();
  // 方案 3：注册 dsh 状态域 IPC（dsh:state 拉一次，dsh:state-change 推流）
  registerDshIpc(dsh);
}
