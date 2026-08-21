import type { ChatMessage, Requirements } from '../storage/types';
import type { ElementInfo } from '../../shared/types/preview';
import type { VersionPlan } from '../../shared/types/project';

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

/** 开发任务：根据已确认需求生成完整可运行的静态 Web 应用（聚焦 V1/MVP 功能子集） */
export function buildDevelopmentTask(
  requirements: Requirements | null,
  versionPlan?: VersionPlan | null,
): string {
  // 有版本计划时只开发 V1（最小可用版本），避免一次性堆砌全部功能
  const v1Features = versionPlan?.versions[0]?.features;
  const coreFeatures =
    v1Features && v1Features.length > 0 ? v1Features : (requirements?.coreFeatures ?? []);

  const reqText = requirements
    ? JSON.stringify(
        {
          goal: requirements.goal,
          targetUsers: requirements.targetUsers,
          coreFeatures,
          useScenarios: requirements.useScenarios,
          dataRequirements: requirements.dataRequirements,
          visualStyle: requirements.visualStyle,
          platform: requirements.platform,
        },
        null,
        2,
      )
    : '（无需求说明，请向用户确认）';

  const mvpNote =
    v1Features && v1Features.length > 0
      ? `\n【重要】本次只开发 V1（最小可用版本），功能范围仅限上面列出的 coreFeatures，其余功能不要实现。\n`
      : '';

  return `你是 FreeCoder 的全栈开发工程师。请根据以下需求，在当前工作目录生成一个完整可运行的 Web 应用：

【需求】
${reqText}
${mvpNote}
【技术要求】
1. 使用纯 HTML + CSS + JavaScript（单页应用，无需构建步骤，双击 index.html 即可运行）
2. 数据持久化使用后端通用数据 API（不要使用 localStorage），通过 FreeCoderAuth.data() 操作
3. 至少生成 index.html、style.css、app.js 三个文件
4. 界面简洁美观，使用中文界面，符合需求中的视觉风格
5. 确保应用功能完整可交互
6. 登录与数据系统已内置（登录窗口由 auth.js 提供，后端由 server.js 提供），请按以下方式集成：
   - 在 index.html 中引入 <script src="auth.js"></script>
   - 页面加载时调用 window.FreeCoderAuth.init()（恢复登录状态）
   - 需要登录后才能使用的功能：在 JS 中调用 await window.FreeCoderAuth.requireLogin()，未登录时会自动弹出登录窗口，登录后返回当前用户；用户取消登录则返回 null，此时应提示"请先登录"
   - 用 window.FreeCoderAuth.isLoggedIn() 判断登录状态，window.FreeCoderAuth.logout() 登出
   - 业务数据使用后端集合 API（每个用户数据互相隔离）：
       const db = window.FreeCoderAuth.data('集合名'); // 集合名用英文，如 todos / records / notes
       // 列表查询（支持分页/搜索/排序）：
        const result = await db.list({ page: 1, pageSize: 20, sort: 'createdAt', order: 'desc', search: '关键词' });
        // result.items → 数据数组, result.pagination → { page, pageSize, total, totalPages }
        // 不传参数则返回全部：const all = await db.list();
       const item = await db.create({...});   // 新建（自动生成 id / createdAt / updatedAt）
       const updated = await db.update(id, {...}); // 更新
       await db.remove(id);                   // 删除
     未登录时调用 data() 会自动弹出登录窗口，登录后继续操作
   - 不要修改或删除 auth.js、server.js 两个文件

完成后回复一句话总结（例如：已完成记账应用开发）。`;
}

/** 版本分段任务：基于已确认需求，把功能切分为 V1（MVP）与后续版本 */
export function buildVersionPlanTask(requirements: Requirements): string {
  return `你是 FreeCoder 的产品经理。用户已确认以下需求，但非技术用户容易追求大而全。请帮用户把功能按版本切分，先做一个最小可用版本（MVP）。

【已确认需求】
${JSON.stringify(
    {
      goal: requirements.goal,
      targetUsers: requirements.targetUsers,
      coreFeatures: requirements.coreFeatures,
      useScenarios: requirements.useScenarios,
      visualStyle: requirements.visualStyle,
    },
    null,
    2,
  )}

【切分原则】
1. V1 只保留最核心、没有它应用就不成立的功能（通常 1-3 个），保证快速可用
2. 其余功能放入 V2（以及必要时 V3），作为后续完善
3. 每个版本的 description 用一句通俗的话说明该版本能做什么
4. features 必须从上面 coreFeatures 中原样选取，不要新增或改写

只输出一个 JSON 对象，不要输出任何其他文字，格式如下：
{"versions":[{"label":"V1","description":"一句话说明","features":["功能1"]},{"label":"V2","description":"一句话说明","features":["功能2","功能3"]}]}
`;
}

/** 修改任务：基于现有代码实施用户的口语修改指令 */
export function buildModifyTask(
  message: string,
  selectedElement: ElementInfo | undefined,
  requirements: Requirements | null,
): string {
  const elementText = selectedElement
    ? `目标元素信息：
- 选择器：${selectedElement.selector}
- 标签：${selectedElement.tag}
- 内容：${selectedElement.content || '（无文本）'}
- 当前样式：颜色 ${selectedElement.styles.color ?? '未知'}，字号 ${selectedElement.styles.fontSize ?? '未知'}，字重 ${selectedElement.styles.fontWeight ?? '未知'}，背景 ${selectedElement.styles.backgroundColor ?? '未知'}，圆角 ${selectedElement.styles.borderRadius ?? '未知'}
请优先只修改这个元素（通过选择器定位）。`
    : '用户没有指定具体元素，请根据描述判断要修改的元素。';

  return `你是 FreeCoder 的开发工程师。当前工作目录中已有一个可运行的 Web 应用（index.html / style.css / app.js），用户提出了修改要求。

【项目需求背景】
${requirements ? JSON.stringify({ goal: requirements.goal, visualStyle: requirements.visualStyle }) : '（无）'}

【用户的修改要求】
${message}

【${selectedElement ? '目标元素' : '修改提示'}】
${elementText}

【要求】
1. 直接编辑现有文件实施修改，保持应用可运行（不要重建整个项目）
2. 修改要具体、最小化，优先改动 CSS 样式
3. 保持界面整体风格一致
4. 不要修改或删除 auth.js、server.js，保持现有登录集成不变

完成后用一句话回复改了什么（例如：已将标题颜色调整为天蓝色 #4A90D9）。`;
}
