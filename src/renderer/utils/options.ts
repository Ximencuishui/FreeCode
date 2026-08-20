import type { ChatOption } from '../store/chat';

/**
 * 解析 AI 消息中的选项（格式：A. 选项一\nB. 选项二\nC. 选项三）。
 * 仅当识别出 ≥2 个选项时返回，避免误解析普通文本。
 */
export function parseOptions(content: string): ChatOption[] {
  const lines = content.split(/\r?\n/);
  const options: ChatOption[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*([A-Z])\s*[.、:：)）]\s*(.+?)\s*$/);
    if (match) {
      options.push({ key: match[1], label: match[2].trim() });
    }
  }

  return options.length >= 2 ? options : [];
}
