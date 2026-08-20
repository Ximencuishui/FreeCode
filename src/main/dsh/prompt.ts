import type { ChatMessage, Requirements } from '../storage/types';

/**
 * AI 助理对话任务构建。
 * headless 单次任务模式下，把「系统提示 + 需求上下文 + 对话历史 + 新消息」拼进任务文本。
 * （多轮会话策略见 docs/dsh-集成调研.md 2.3）
 */

export const ASSISTANT_SYSTEM_PROMPT = `你是 FreeCoder 的产品需求分析师（AI 助理），帮助非技术用户把模糊的想法变成清晰、可开发的需求。

规则：
1. 用中文、友好、有耐心的语气与用户对话，一次只问 1-2 个问题。
2. 需要提供选项时，用以下格式（每行一个选项，字母从 A 开始）：
A. 选项一
B. 选项二
C. 选项三
3. 逐步澄清：项目名称、一句话目标、目标用户、核心功能、使用场景、需要保存的数据、视觉风格、平台（web / 小程序 / 全平台）。
4. 用户可以说「跳过」或「我不知道」，不要强迫，不要一次问太多。
5. 当需求足够明确（至少包含：一句话目标 + 目标用户 + 核心功能列表）时，只输出一个 JSON 对象，不要输出任何其他文字，格式如下：
{"project_name":"项目名","goal":"一句话目标","target_users":"目标用户","core_features":["功能1","功能2"],"use_scenarios":"使用场景","data_requirements":["数据1"],"visual_style":"视觉风格描述","platform":"web"}
platform 取值：web / mini-program / both
6. 如果需求还不够明确，就继续用自然语言提问，不要输出 JSON。`;

interface BuildTaskInput {
  message: string;
  history: ChatMessage[];
  requirements: Requirements | null;
}

/** 格式化对话历史（最近 20 条） */
function formatHistory(history: ChatMessage[]): string {
  const recent = history.slice(-20);
  return recent
    .map((m) => {
      const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助理' : '系统';
      return `${role}：${m.content}`;
    })
    .join('\n');
}

/** 格式化已确认的需求上下文 */
function formatRequirements(requirements: Requirements | null): string {
  if (!requirements) return '（尚无已确认的需求）';
  return JSON.stringify({
    goal: requirements.goal || '（待补充）',
    targetUsers: requirements.targetUsers || '（待补充）',
    coreFeatures: requirements.coreFeatures.length > 0 ? requirements.coreFeatures : ['（待补充）'],
    useScenarios: requirements.useScenarios || '（待补充）',
    visualStyle: requirements.visualStyle || '（待补充）',
    platform: requirements.platform || 'web',
  });
}

/** 构建 AI 助理的一次性任务文本 */
export function buildAssistantTask(input: BuildTaskInput): string {
  const parts = [
    ASSISTANT_SYSTEM_PROMPT,
    '',
    '【需求上下文】',
    formatRequirements(input.requirements),
    '',
    '【对话历史】',
    formatHistory(input.history) || '（空）',
    '',
    `【用户最新消息】${input.message}`,
    '',
    '请继续。',
  ];
  return parts.join('\n');
}

/** 开发任务：根据已确认需求生成完整可运行的静态 Web 应用 */
export function buildDevelopmentTask(requirements: Requirements | null): string {
  const reqText = requirements
    ? JSON.stringify(
        {
          goal: requirements.goal,
          targetUsers: requirements.targetUsers,
          coreFeatures: requirements.coreFeatures,
          useScenarios: requirements.useScenarios,
          dataRequirements: requirements.dataRequirements,
          visualStyle: requirements.visualStyle,
          platform: requirements.platform,
        },
        null,
        2,
      )
    : '（无需求说明，请向用户确认）';

  return `你是 FreeCoder 的全栈开发工程师。请根据以下需求，在当前工作目录生成一个完整可运行的 Web 应用：

【需求】
${reqText}

【技术要求】
1. 使用纯 HTML + CSS + JavaScript（单页应用，无需构建步骤，双击 index.html 即可运行）
2. 数据持久化使用浏览器 localStorage
3. 至少生成 index.html、style.css、app.js 三个文件
4. 界面简洁美观，使用中文界面，符合需求中的视觉风格
5. 确保应用功能完整可交互

完成后回复一句话总结（例如：已完成记账应用开发）。`;
}
