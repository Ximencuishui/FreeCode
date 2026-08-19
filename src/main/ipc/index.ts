import { registerAppIpc } from './app';
import { registerChatIpc } from './chat';
import { registerProjectIpc } from './project';
import { registerPreviewIpc } from './preview';
import { registerExportIpc } from './export';
import { registerSettingsIpc } from './settings';
import { registerApiKeyIpc } from './apikey';

/** 注册全部 IPC 处理器（21 个通道，见 API 文档第七章接口清单） */
export function registerIpcHandlers(): void {
  registerAppIpc();
  registerChatIpc();
  registerProjectIpc();
  registerPreviewIpc();
  registerExportIpc();
  registerSettingsIpc();
  registerApiKeyIpc();
}
