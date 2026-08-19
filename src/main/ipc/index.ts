import { registerAppIpc } from './app';
import { registerChatIpc } from './chat';
import { registerProjectIpc } from './project';
import { registerPreviewIpc } from './preview';
import { registerExportIpc } from './export';
import { registerSettingsIpc } from './settings';
import { registerApiKeyIpc } from './apikey';
import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';

/** 注册全部 IPC 处理器（21 个通道，见 API 文档第七章接口清单） */
export function registerIpcHandlers(storage: StorageManager, dsh: DSHService): void {
  registerAppIpc();
  registerChatIpc(storage, dsh);
  registerProjectIpc(storage);
  registerPreviewIpc();
  registerExportIpc();
  registerSettingsIpc(storage);
  registerApiKeyIpc(storage);
}
