import { registerAppIpc } from './app';
import { registerChatIpc } from './chat';
import { registerProjectIpc } from './project';
import { registerPreviewIpc } from './preview';
import { registerExportIpc } from './export';
import { registerSettingsIpc } from './settings';
import { registerApiKeyIpc } from './apikey';
import type { StorageManager } from '../storage/types';

/** 注册全部 IPC 处理器（21 个通道，见 API 文档第七章接口清单） */
export function registerIpcHandlers(storage: StorageManager): void {
  registerAppIpc();
  registerChatIpc(storage);
  registerProjectIpc(storage);
  registerPreviewIpc();
  registerExportIpc();
  registerSettingsIpc(storage);
  registerApiKeyIpc(storage);
}
