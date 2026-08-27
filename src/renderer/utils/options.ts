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

export interface QuestionBlock {
  /** 问题文本（可能含上下文铺垫） */
  question: string;
  /** 该问题的选项（≥2 个） */
  options: ChatOption[];
}

/**
 * 从 AI 回复中提取「问题 + 选项」块（支持多个问题，如需求审查一次问 2 个矛盾点）：
 * - 识别 A/B/C 选项行与「请选择：」「Options for ...」引导行
 * - 每个「引导行 + 选项组」与其前面的文本组成一个块；选项不足 2 个不成块
 */
export function extractQuestionBlocks(content: string): QuestionBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: QuestionBlock[] = [];
  let pending: string[] = [];
  let currentOptions: ChatOption[] = [];
  let inOptions = false;

  const flush = () => {
    if (currentOptions.length >= 2) {
      blocks.push({
        question: pending.join('\n').trim() || '请选择：',
        options: currentOptions,
      });
    }
    pending = [];
    currentOptions = [];
    inOptions = false;
  };

  for (const line of lines) {
    const optMatch = line.match(/^\s*([A-Z])\s*[.、:：)）]\s*(.+?)\s*$/);
    // 选项引导行（如「请选择：」「Options for goal:」）
    if (/^\s*(请选择|选择|Options for)/i.test(line.trim())) {
      inOptions = true;
      continue;
    }
    if (optMatch) {
      inOptions = true;
      currentOptions.push({ key: optMatch[1], label: optMatch[2].trim() });
      continue;
    }
    // 普通文本行：上一组选项已收集完毕 → 结算该块，当前行开始下一个问题
    if (inOptions && currentOptions.length >= 2) {
      flush();
    }
    pending.push(line);
  }
  flush();
  return blocks;
}
