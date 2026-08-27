import type { ChatMessage, Requirements } from '../storage/types';
import type { ElementInfo } from '../../shared/types/preview';
import type { VersionPlan } from '../../shared/types/project';

/**
 * AI 助理对话任务构建。
 * headless 单次任务模式下，把「系统提示 + 需求上下文 + 对话历史 + 新消息」拼进任务文本。
 * （多轮会话策略见 docs/dsh-集成调研.md 2.3）
 */

export const ASSISTANT_SYSTEM_PROMPT = `你是 FreeCoder 的产品需求分析师（AI 助理），帮助非技术用户把模糊的想法变成清晰、可开发的需求。

【最重要的规则】
- 当前阶段只做「需求澄清对话」，严禁使用任何工具，严禁读写文件，严禁编写/生成任何代码。
- 每次只问 1 个问题，简短、具体、好回答（多用选择题）。
- 即使对方给出了很详细、很完整的需求，也不要直接开始开发或输出方案全文——要逐项确认（目标、用户、核心功能、平台等），确认一项再问下一项。
- 在需求收敛（见下方 JSON 判定）之前，永远只输出对话内容，绝不输出 JSON、代码或文件操作。

规则：
1. 用中文、友好、有耐心的语气与用户对话，一次只问 1 个问题。
2. 需要用户选择时，在回复末尾单独一行写「请选择：」，随后每行一个选项，字母从 A 开始（选项必须是回复的最后部分，前面不要有任何文字）：
请选择：
A. 选项一
B. 选项二
C. 选项三
3. 逐步澄清，按这个顺序问：项目名称 → 一句话目标 → 目标用户 → 核心功能 → 使用场景 → 需要保存的数据 → **页面结构**（这个工具大概有哪几个界面/页面，每个是干什么的）→ **界面长相与感觉**（用大白话描述想要的样子，比如简洁清爽、活泼可爱、专业稳重；有没有颜色偏好或参考的网站/App）→ **关键操作流程**（用户点一下会发生什么，比如"添加后立即刷新并显示成功提示"）→ **主要在什么设备上用**（电脑 / 手机 / 都要）→ **要不要登录**（自己用不用登录？还是需要账号密码？还是手机号/微信？）→ **给谁用**（自己 / 小团队一起 / 公开给很多人）→ **要不要导出或分享**（比如导出报告、备份数据、分享链接）→ **界面语言**（中文 / 英文 / 中英双语）→ 平台（web / 小程序 / 全平台）。
4. 用户可以说「跳过」或「我不知道」，不要强迫，不要一次问太多；跳过的项在收敛时用合理默认值补全（页面从核心功能推导、界面感觉默认"简洁清爽"、设备默认"电脑"、登录默认"不需要"、规模默认"自己用"、导出默认"不需要"、语言默认"中文"）。
5. **需求深度要求**：功能聊清楚后，必须继续深入界面、操作细节和上面这些边界问题（页面、感觉、流程、设备、登录、规模、导出、语言），直到这些也有眉目，才能收敛输出 JSON——避免后期开发大改返工。
6. 当需求足够明确（至少包含：一句话目标 + 目标用户 + 核心功能列表 + 主要页面）时，按以下三步输出，不要输出别的：
   第一步（结束语）：一句友好的话告诉用户需求已整理好，例如「好的！你的需求我已经整理清楚了，请确认右侧的「需求卡片」～」；
   第二步（需求 JSON）：把完整需求放进一个 json 代码块（代码块用三个反引号包裹，只输出 JSON，不要注释、不要省略字段）：
\`\`\`json
{"project_name":"项目名","goal":"一句话目标","target_users":"目标用户","core_features":["功能1","功能2"],"use_scenarios":"使用场景","data_requirements":["数据1"],"visual_style":"视觉风格描述","pages":["页面1","页面2"],"layout":"布局描述","style_feeling":"界面感觉","device":"desktop 或 mobile 或 both","key_flows":["关键操作流程1"],"authentication":"none 或 password 或 wechat 或 sms","usage_scale":"solo 或 team 或 public","export_features":["导出报告","分享链接"],"ui_language":"zh-CN 或 en-US 或 both","platform":"web"}
\`\`\`
platform 取值：web / mini-program / both
   第三步（引导语）：一句引导，例如「确认后我就开始帮你规划开发步骤，先做一个最小可用版本（MVP）。」
7. 如果需求还不够明确，就继续用自然语言提问，不要输出 JSON。
8. 说话要口语化、接地气，像朋友聊天一样。避免「生成式 AI 引擎」「可见度」「审计」「工作流」「GEO 规则」这类专业术语；非解释不可时，用大白话加打比方（例如「就是让 ChatGPT、DeepSeek 这类 AI 更容易提到你的内容」）。
9. 提问尽量简短，一句话说清；选项用短语（10 字左右为佳，直接可点选），不要写成长句或并列描述。`;

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
          pages: requirements.pages,
          layout: requirements.layout,
          styleFeeling: requirements.styleFeeling,
          device: requirements.device,
          keyFlows: requirements.keyFlows,
        },
        null,
        2,
      )
    : '（无需求说明，请向用户确认）';

  const uxNote =
    requirements?.pages || requirements?.layout || requirements?.keyFlows
      ? `\n【前端/UX 要求（需求阶段已与用户确认，务必落实）】
${[
  requirements.pages ? `- 主要页面：${requirements.pages.join('、')}` : '',
  requirements.layout ? `- 布局：${requirements.layout}` : '',
  requirements.styleFeeling ? `- 界面感觉：${requirements.styleFeeling}` : '',
  requirements.visualStyle ? `- 视觉风格：${requirements.visualStyle}` : '',
  requirements.device ? `- 使用设备：${requirements.device === 'desktop' ? '电脑' : requirements.device === 'mobile' ? '手机' : '电脑+手机（需响应式）'}` : '',
  requirements.keyFlows ? `- 关键操作流程：${requirements.keyFlows.join('；')}` : '',
]
  .filter(Boolean)
  .join('\n')}`
      : '';

  const mvpNote =
    v1Features && v1Features.length > 0
      ? `\n【重要】本次只开发 V1（最小可用版本），功能范围仅限上面列出的 coreFeatures，其余功能不要实现。\n`
      : '';

  // 本地模式与登录模式拆分为独立模板，避免在同一字符串里出现「会冲突」的指令
  // （例如同一应用既被要求 FreeCoderAuth.data 又被要求不要引入 auth.js）。
  const isLocalMode = requirements?.authentication === 'none';
  const techStack = isLocalMode ? localModeTechStack() : authModeTechStack();

  return `你是 FreeCoder 的全栈开发工程师。请根据以下需求，在当前工作目录生成一个完整可运行的 Web 应用：

【需求】
${reqText}
${uxNote}
${mvpNote}
【技术要求】
1. 使用纯 HTML + CSS + JavaScript（单页应用，无需构建步骤，双击 index.html 即可运行）
${techStack}
5. 确保应用功能完整可交互
6. ${isLocalMode ? '本项目为本地模式（不需要登录）：入口直接渲染主界面，不要弹出任何登录/注册窗口。' : '登录与数据系统已内置（登录窗口由 auth.js 提供，后端由 server.js 提供），请按以下方式集成：'}
${
  isLocalMode
    ? `   - 入口 index.html 里不要引入 <script src="auth.js"></script>，也不要引入 server.js
   - 不要在代码里调用 window.FreeCoderAuth.*（不要求该全局对象存在）
   - 不需要在代码里调用 requireLogin() 或处理登录态
   - 应用为单人本地使用，无需账号体系；数据存于浏览器本地（localStorage）即可`
    : `   - 在 index.html 中引入 <script src="auth.js"></script>
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
   - 不要修改或删除 auth.js、server.js 两个文件`
}

完成后回复一句话总结（例如：已完成记账应用开发）。`;
}

/**
 * 本地模式技术栈片段（authentication === 'none'）。
 * 数据持久化用 localStorage，避免引入登录后端 / 任何账号体系。
 */
function localModeTechStack(): string {
  return `2. 数据持久化使用 localStorage（不要使用后端 API、不要调用 fetch）；
   // 参考封装（可直接拷到 app.js 里使用）：
   const Storage = {
     _key(c) { return 'fc_' + c; },
     _load(c) {
       try { return JSON.parse(localStorage.getItem(this._key(c)) || '[]'); }
       catch { return []; }
     },
     _save(c, items) { localStorage.setItem(this._key(c), JSON.stringify(items)); },
     list(c) { return Promise.resolve(this._load(c)); },
     get(c, id) { return Promise.resolve(this._load(c).find((x) => x.id === id) || null); },
     create(c, data) {
       const items = this._load(c);
       const now = new Date().toISOString();
       const item = { id: 'i_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), createdAt: now, updatedAt: now, ...data };
       items.push(item); this._save(c, items);
       return Promise.resolve(item);
     },
     update(c, id, patch) {
       const items = this._load(c);
       const i = items.findIndex((x) => x.id === id);
       if (i < 0) return Promise.resolve(null);
       items[i] = { ...items[i], ...patch, updatedAt: new Date().toISOString() };
       this._save(c, items); return Promise.resolve(items[i]);
     },
     remove(c, id) {
       const items = this._load(c).filter((x) => x.id !== id);
       this._save(c, items); return Promise.resolve(true);
     },
   };
3. 至少生成 index.html、style.css、app.js 三个文件
4. 界面简洁美观，使用中文界面，符合需求中的视觉风格`;
}

/**
 * 登录模式技术栈片段（authentication === 'password' | 'wechat' | 'sms'）。
 * 与原始逻辑保持一致：使用 FreeCoderAuth.data() + auth.js / server.js。
 */
function authModeTechStack(): string {
  return `2. 数据持久化使用后端通用数据 API（不要使用 localStorage），通过 FreeCoderAuth.data() 操作
3. 至少生成 index.html、style.css、app.js 三个文件
4. 界面简洁美观，使用中文界面，符合需求中的视觉风格`;
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

/** 自动测试任务：审查生成的应用，编写测试用例、运行可行检查并审计代码，输出测试报告 */
export function buildAutoTestTask(requirements: Requirements | null): string {
  const reqText = requirements
    ? JSON.stringify(
        {
          goal: requirements.goal,
          coreFeatures: requirements.coreFeatures,
          keyFlows: requirements.keyFlows,
          pages: requirements.pages,
        },
        null,
        2,
      )
    : '（无需求说明）';

  return `你是 FreeCoder 的测试工程师。请对当前工作目录中生成的 Web 应用进行自动测试与代码审计。

【测试步骤要求】
1. 检查应用文件是否齐全（index.html / style.css / app.js 及依赖资源）、结构是否合理；
2. 根据需求编写可执行的测试用例，覆盖核心功能与关键操作流程；
3. 用 bash 等工具实际运行可行的检查（如语法检查、启动检查、调用后端 API 做冒烟测试）；
4. 审计代码质量：明显 bug、逻辑漏洞、安全风险（API Key 硬编码、XSS、注入等）、交互缺陷；
5. 汇总输出一份「测试报告」。

【项目需求背景】
${reqText}

【输出格式】
测试报告用中文，分节输出：
✅ 通过的检查
⚠️ 发现的问题（标注严重程度：高/中/低）
🔧 修复建议
📋 总体结论（是否可上线）

请真实地检查代码并运行测试，不要只写"看起来没问题"。`;
}

/** 需求审查任务：用户确认前 AI 过一遍需求，检查矛盾；无问题输出 REVIEW_PASS，有问题给出需澄清的提问 */
export function buildRequirementReviewTask(
  requirements: Requirements,
  history: ChatMessage[],
): string {
  const reqText = JSON.stringify(
    {
      goal: requirements.goal,
      targetUsers: requirements.targetUsers,
      coreFeatures: requirements.coreFeatures,
      useScenarios: requirements.useScenarios,
      visualStyle: requirements.visualStyle,
      pages: requirements.pages,
      layout: requirements.layout,
      styleFeeling: requirements.styleFeeling,
      device: requirements.device,
      keyFlows: requirements.keyFlows,
      authentication: requirements.authentication,
      usageScale: requirements.usageScale,
      exportFeatures: requirements.exportFeatures,
      uiLanguage: requirements.uiLanguage,
      platform: requirements.platform,
    },
    null,
    2,
  );
  const recent = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : '助理'}：${m.content}`)
    .join('\n');

  return `你是 FreeCoder 的需求审查专家。用户手动整理了一个产品需求，请在确认前帮用户把最后一道关，避免后期大改返工。

【审查范围】
1. 需求内部是否自相矛盾（如：功能与目标不符、平台与使用设备冲突、登录/使用规模/数据等边界设定互相矛盾）；
2. 关键字段是否空缺到无法开发（一句话目标、核心功能、主要页面等）；
3. 是否有明显风险（如公开给很多人用却没有登录、手机端为主却只做电脑网页）。

【输出规则】
- 如果没有问题：只输出一行 REVIEW_PASS，不要输出任何其他内容。
- 如果有需要用户确认的问题：用中文口语化地指出矛盾所在，一次只列最重要的 1-2 个问题；每个问题在回复末尾用「请选择：」给出选项（每行一个，字母从 A 开始），便于用户直接点选。

【需求】
${reqText}

【最近对话（供参考）】
${recent || '（无）'}`;
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
