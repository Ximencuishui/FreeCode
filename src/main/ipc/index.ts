import { registerAppIpc } from './app';
import { registerChatIpc } from './chat';
import { registerProjectIpc } from './project';
import { registerPreviewIpc } from './preview';
import { registerExportIpc } from './export';
import { registerSettingsIpc } from './settings';
import { registerApiKeyIpc } from './apikey';
import { registerDbIpc } from './db';
import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import type { Developer } from '../dev/developer';
import type { VersionPlanner } from '../dev/planner';

/** 注册全部 IPC 处理器（25 个通道，见 API 文档第七章接口清单） */
export function registerIpcHandlers(
  storage: StorageManager,
  dsh: DSHService,
  developer: Developer,
  planner: VersionPlanner,
): void {
  registerAppIpc(dsh);
  registerChatIpc(storage, dsh);
  registerProjectIpc(storage, dsh, developer, planner);
  registerPreviewIpc(storage);
  registerExportIpc(storage);
  registerSettingsIpc(storage);
  registerApiKeyIpc(storage);
  registerDbIpc();
}
