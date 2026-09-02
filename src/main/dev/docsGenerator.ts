/**
 * 项目文档 / 基础素材生成器（WP-15 配套）
 *
 * 需求 / 版本计划等结构化数据原本只落盘为 requirements.json / meta.json，
 * 但【文档】工作区只扫描项目里的真实文件（Markdown + 图片），导致「需求确认
 * 完成、版本计划已生成」之后用户点开【文档】却空空如也。
 *
 * 这里把结构化数据翻译成人类可读的文件，写入项目代码目录：
 * - README.md（项目入口说明 + 文档导航 + 快速开始）—— 项目根
 * - docs/requirements.md（需求说明书）
 * - docs/version-plan.md（版本分段计划）
 * - assets/logo.svg（占位 logo：DSH 未生成时由主进程兜底，避免图片素材区为空）
 *
 * 写入时机：
 * 1. 需求确认通过（project:confirm）→ 主进程写 requirements.md + README.md
 * 2. 版本计划生成完成（planner.generatePlan onDone）→ 主进程写 version-plan.md
 *    并刷新 README 里的「核心功能 / V1/V2」索引
 * 3. 用户调整版本计划并确认（project:confirmPlan）→ 主进程用最新 plan 重写
 *    version-plan.md + README.md
 * 4. 开发完成（developer.startDevelopment onDone）→ 若 assets/logo.svg 缺失则
 *    写一份占位 SVG，避免【文档】Tab 的「图片素材」分类永远为空
 * 5. 列表扫描（project:list-documents）若发现项目已具备数据但 README/docs 缺失
 *    → 自动回填，让历史项目（升级到本版本之前创建的）首次进入【文档】时也能
 *    立即看到。回填永远不覆盖用户已存在的文件（先 stat 后写入）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageManager, ProjectMeta, Requirements } from '../storage/types';
import type { VersionPlan, VersionPlanVersion } from '../../shared/types/project';

/** 文档输出目录：固定使用 `<项目代码目录>/docs/`，与 scanProjectFiles 的规则一致 */
function docsDir(codePath: string): string {
  return path.join(codePath, 'docs');
}

/** assets 目录：图片素材默认输出位置（与 DEFAULT_OPEN_FOLDERS 中的 assets 一致） */
function assetsDir(codePath: string): string {
  return path.join(codePath, 'assets');
}

/** requirements.md 输出路径 */
export function requirementsDocPath(codePath: string): string {
  return path.join(docsDir(codePath), 'requirements.md');
}

/** version-plan.md 输出路径 */
export function versionPlanDocPath(codePath: string): string {
  return path.join(docsDir(codePath), 'version-plan.md');
}

/** README.md 输出路径：放在项目根，方便打开 index.html 时一眼看到 */
export function readmeDocPath(codePath: string): string {
  return path.join(codePath, 'README.md');
}

/** 占位 logo 输出路径：放在 assets/，DSH 已有同名文件时不会被覆盖 */
export function logoPlaceholderPath(codePath: string): string {
  return path.join(assetsDir(codePath), 'logo.svg');
}

/** 同步把 ISO 时间戳转成「YYYY-MM-DD HH:mm」形式，UI 上更友好 */
function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/**
 * 把任意字符串压成单行、去除控制字符、防止 Markdown 段落/链接被破坏。
 * 这是 docsGenerator 输出文档时的统一防线：
 * - 用户输入的项目名 / goal / coreFeatures / keyFlows 都来自对话，可能含换行、
 *   反引号、方括号等 Markdown 敏感字符；不处理就直接拼到 `# 标题`、`> 引用`、`- 列表`、
 *   表格单元格、链接文本里，会被解释成新的结构元素（注入章节、破坏链接）。
 * - 文档会被 Electron 渲染进程解释（DocumentMarkdown）、也会被用户复制到 GitHub /
 *   VS Code 等环境，副作用会跨过应用边界。
 * - 单行折叠同时避免了"项目名里有个 \n → README 标题被切成两段"这种排版事故。
 *
 * 过滤字符的选择：
 * - 删除 `\r / \n / \t / \0..\u001f / \u007f / \u2028 / \u2029`（控制字符 + 行分隔符）
 * - 删除 `| < > #` 这些会破坏 Markdown 结构布局的元字符（其余 * _ ~ 等"格式强调"
 *   字符保留为字面字符不会破坏结构；如果用户输入确实想表达强调，留作字面也合理）
 */
function sanitizeInline(value: string | undefined): string {
  if (!value) return '';
  return value
    // 去掉 \r（Windows 风格换行 / 旧 mac 换行）
    .replace(/\r/g, '')
    // 把所有换行 / 制表符 / 其他控制字符折叠成单空格；保留 \n 之外的可打印字符
    // eslint-disable-next-line no-control-regex -- 故意剥离控制字符，防止注入到 Markdown
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    // 删除会破坏 Markdown 结构布局的元字符（# 标题 / | 表格 / < > HTML）
    .replace(/[|<>#]/g, '')
    // 折叠连续空白
    .replace(/\s{2,}/g, ' ')
    // 修剪首尾
    .trim();
}

/** 把设备 / 登录 / 规模 / 语言 / 平台枚举值翻译成中文，避免出现裸英文 */
function translateDevice(device: Requirements['device']): string {
  switch (device) {
    case 'desktop':
      return '电脑';
    case 'mobile':
      return '手机';
    case 'both':
      return '电脑 + 手机（需要响应式）';
    default:
      return '未指定';
  }
}

function translateAuth(auth: Requirements['authentication']): string {
  switch (auth) {
    case 'none':
      return '不需要登录（本地单人使用）';
    case 'password':
      return '账号密码';
    case 'wechat':
      return '微信';
    case 'sms':
      return '手机号';
    default:
      return '未指定';
  }
}

function translateScale(scale: Requirements['usageScale']): string {
  switch (scale) {
    case 'solo':
      return '自己用';
    case 'team':
      return '小团队一起';
    case 'public':
      return '公开给很多人';
    default:
      return '未指定';
  }
}

function translateLanguage(lang: Requirements['uiLanguage']): string {
  switch (lang) {
    case 'zh-CN':
      return '中文';
    case 'en-US':
      return '英文';
    case 'both':
      return '中英双语';
    default:
      return '未指定';
  }
}

function translatePlatform(platform: Requirements['platform']): string {
  switch (platform) {
    case 'web':
      return '网页';
    case 'mini-program':
      return '小程序';
    case 'both':
      return '网页 + 小程序';
    default:
      return '未指定';
  }
}

/** 当字段为空时用占位符，避免 Markdown 里出现空标题/空列表造成的"看着像漏了" */
const PLACEHOLDER = '（待补充）';

/**
 * 把结构化 Requirements 翻译成一份人类可读的 Markdown 需求说明书。
 * 输出排版参考产品需求文档 v3.x 的章节风格，让用户读起来跟普通文档一致。
 */
export function renderRequirementsDoc(
  project: ProjectMeta,
  requirements: Requirements,
): string {
  const lines: string[] = [];
  // 项目名作为一级标题，特别需要防止用户输入含 `\n## ` 把标题切成多段
  lines.push(`# ${sanitizeInline(project.name) || '项目'} — 需求说明书`);
  lines.push('');
  lines.push(
    `> 本文档由 FreeCoder 根据 AI 助理与你的对话自动整理，保存于 \`docs/requirements.md\`。`,
  );
  lines.push(
    `> 最后更新：${formatTimestamp(requirements.updatedAt)}${requirements.confirmed ? '（已确认）' : '（未确认）'}`,
  );
  lines.push('');
  lines.push('## 1. 一句话目标');
  lines.push('');
  lines.push(sanitizeInline(requirements.goal) || PLACEHOLDER);
  lines.push('');
  lines.push('## 2. 目标用户');
  lines.push('');
  lines.push(sanitizeInline(requirements.targetUsers) || PLACEHOLDER);
  lines.push('');
  lines.push('## 3. 核心功能');
  lines.push('');
  const features = (requirements.coreFeatures ?? []).map(sanitizeInline).filter(Boolean);
  if (features.length === 0) {
    lines.push(PLACEHOLDER);
  } else {
    features.forEach((feature) => lines.push(`- ${feature}`));
  }
  lines.push('');
  lines.push('## 4. 使用场景');
  lines.push('');
  lines.push(sanitizeInline(requirements.useScenarios) || PLACEHOLDER);
  lines.push('');
  lines.push('## 5. 需要保存的数据');
  lines.push('');
  const dataRequirements = (requirements.dataRequirements ?? []).map(sanitizeInline).filter(Boolean);
  if (dataRequirements.length === 0) {
    lines.push(PLACEHOLDER);
  } else {
    dataRequirements.forEach((item) => lines.push(`- ${item}`));
  }
  lines.push('');
  lines.push('## 6. 主要页面');
  lines.push('');
  const pages = (requirements.pages ?? []).map(sanitizeInline).filter(Boolean);
  if (pages.length === 0) {
    lines.push(PLACEHOLDER);
  } else {
    pages.forEach((page) => lines.push(`- ${page}`));
  }
  lines.push('');
  lines.push('## 7. 界面布局与视觉风格');
  lines.push('');
  lines.push(`- **布局**：${sanitizeInline(requirements.layout) || PLACEHOLDER}`);
  lines.push(`- **界面感觉**：${sanitizeInline(requirements.styleFeeling) || PLACEHOLDER}`);
  lines.push(`- **视觉风格**：${sanitizeInline(requirements.visualStyle) || PLACEHOLDER}`);
  lines.push(`- **主要设备**：${translateDevice(requirements.device)}`);
  lines.push('');
  lines.push('## 8. 关键操作流程');
  lines.push('');
  const keyFlows = (requirements.keyFlows ?? []).map(sanitizeInline).filter(Boolean);
  if (keyFlows.length === 0) {
    lines.push(PLACEHOLDER);
  } else {
    keyFlows.forEach((flow) => lines.push(`- ${flow}`));
  }
  lines.push('');
  lines.push('## 9. 边界设定');
  lines.push('');
  lines.push(`- **登录方式**：${translateAuth(requirements.authentication)}`);
  lines.push(`- **使用规模**：${translateScale(requirements.usageScale)}`);
  const exportFeatures = (requirements.exportFeatures ?? []).map(sanitizeInline).filter(Boolean);
  lines.push(
    `- **导出 / 分享**：${exportFeatures.length > 0 ? exportFeatures.join('、') : '不需要'}`,
  );
  lines.push(`- **界面语言**：${translateLanguage(requirements.uiLanguage)}`);
  lines.push(`- **目标平台**：${translatePlatform(requirements.platform)}`);
  lines.push('');
  lines.push('## 10. 需求变更记录');
  lines.push('');
  const history = requirements.history ?? [];
  if (history.length === 0) {
    lines.push(PLACEHOLDER);
  } else {
    history.forEach((entry) => {
      // entry.changes 是主进程写入的"AI 助理生成需求"等英文短语，但仍走 sanitizeInline 防御
      lines.push(`- ${formatTimestamp(entry.timestamp)} · ${sanitizeInline(entry.changes) || PLACEHOLDER}`);
    });
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    '_本文档由 FreeCoder 自动生成，可在文档工作区查看。如果发现与实际需求不一致，回到对话页让 AI 助理调整即可。_',
  );
  lines.push('');
  return lines.join('\n');
}

/** 把单个版本渲染成一个二级章节 */
function renderVersion(version: VersionPlanVersion): string {
  const lines: string[] = [];
  // label 是 V1/V2/V3 等标签，理论上安全；但仍过 sanitizeInline 防误用
  lines.push(`### ${sanitizeInline(version.label) || '未命名版本'}`);
  lines.push('');
  lines.push(sanitizeInline(version.description) || PLACEHOLDER);
  lines.push('');
  const features = version.features.map(sanitizeInline).filter(Boolean);
  if (features.length === 0) {
    lines.push('**本版本包含**：' + PLACEHOLDER);
  } else {
    lines.push('**本版本包含**：');
    features.forEach((feature) => lines.push(`- ${feature}`));
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * 把结构化 VersionPlan 翻译成 Markdown 版本分段计划。
 * V1 高亮为"最小可用版本"，方便用户一眼找到下一步要做的内容。
 */
export function renderVersionPlanDoc(
  project: ProjectMeta,
  plan: VersionPlan,
): string {
  const lines: string[] = [];
  lines.push(`# ${sanitizeInline(project.name) || '项目'} — 版本分段计划`);
  lines.push('');
  lines.push(
    `> 本文档由 FreeCoder 根据已确认需求自动生成，保存于 \`docs/version-plan.md\`。`,
  );
  lines.push(`> 最后更新：${formatTimestamp(project.updatedAt)}`);
  lines.push('');
  lines.push('## 设计原则');
  lines.push('');
  lines.push(
    '- 先做**最小可用版本**（V1），保证应用能跑起来、用起来，再迭代完善。',
  );
  lines.push('- 避免一次性堆砌全部功能：一次做完所有功能通常要花更久、出错更多。');
  lines.push('- 后续版本（V2 / V3 …）按优先级补齐，让用户能逐步看到价值。');
  lines.push('');
  if (plan.versions.length === 0) {
    lines.push('## 版本列表');
    lines.push('');
    lines.push(PLACEHOLDER);
  } else {
    lines.push('## 版本列表');
    lines.push('');
    plan.versions.forEach((version, index) => {
      const tag = index === 0 ? '（最小可用版本 / MVP）' : '';
      lines.push(`## ${index + 1}. ${version.label}${tag}`);
      lines.push('');
      lines.push(renderVersion(version).trimEnd());
    });
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    '_本文档由 FreeCoder 自动生成，可在文档工作区查看。调整版本计划请回到对话页。_',
  );
  lines.push('');
  return lines.join('\n');
}

/**
 * 从项目名提取 logo 上的首字母标识：
 * - CJK（基本 + 扩展 A）、谚文音节、日文假名 → 原样
 * - 拉丁字母 → 转大写
 * - 拉丁扩展（带音标）、希腊字母 → 原样
 * - 数字 → 原样
 * - emoji / 控制字符 / 标点 / 其他 → 兜底 `★`
 *
 * 始终返回 1 个可见字符。注意：本函数仅返回"安全字符集合"内的字符，
 * 因此下游 escapeXml 几乎不会被触发（属深度防御）。若未来扩展首字符
 * 取值范围（例如允许整段名称前两字），需同步在测试里加 SVG 输出回归。
 */
function deriveLogoInitial(projectName: string): string {
  const trimmed = projectName.trim();
  if (!trimmed) return '★';
  // Array.from 能正确按 code point 切分，避免 surrogate pair（emoji / 罕用字）切碎
  const firstChar = Array.from(trimmed)[0] ?? '★';
  // CJK 统一（基本 + 扩展 A）+ 谚文音节 + 日文假名 → 原样
  if (/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(firstChar)) {
    return firstChar;
  }
  // ASCII 字母 → 转大写
  if (/[a-zA-Z]/.test(firstChar)) return firstChar.toUpperCase();
  // 拉丁字母扩展（含音标 À Á Â…） + 希腊字母 → 原样
  if (/[\u00c0-\u024f\u0370-\u03ff]/.test(firstChar)) return firstChar;
  // 数字 → 原样
  if (/[0-9]/.test(firstChar)) return firstChar;
  // 其他（emoji / 控制字符 / 标点）→ 兜底
  return '★';
}

/**
 * 生成一个 128×128 的占位 logo SVG：
 * - 圆角矩形 + 蓝紫渐变背景（与 FreeCoder 品牌色一致）
 * - 中央显示项目名首字母
 * - 底部小字 "FreeCoder" 副标题
 *
 * 用 SVG 而非 PNG：纯文本、可缩放、文件极小（< 1KB），DSH 也能直接 <img> 引用。
 * 仅在 DSH 未生成任何图片素材时作为兜底，绝不覆盖 assets/ 下已有的 logo/favicon。
 */
export function renderLogoPlaceholder(project: ProjectMeta): string {
  const initial = escapeXml(deriveLogoInitial(project.name));
  // 不同首字母使用不同色调，避免所有项目 logo 都长一样
  const hue = ((project.name.charCodeAt(0) || 0) * 17) % 360;
  const startColor = `hsl(${hue}, 70%, 55%)`;
  const endColor = `hsl(${(hue + 40) % 360}, 65%, 40%)`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">',
    '  <defs>',
    '    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    `      <stop offset="0%" stop-color="${startColor}"/>`,
    `      <stop offset="100%" stop-color="${endColor}"/>`,
    '    </linearGradient>',
    '  </defs>',
    '  <rect width="128" height="128" rx="24" fill="url(#bg)"/>',
    `  <text x="64" y="78" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" font-size="56" font-weight="700" text-anchor="middle" fill="#ffffff">${initial}</text>`,
    `  <text x="64" y="108" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" font-size="11" text-anchor="middle" fill="rgba(255,255,255,0.85)">FreeCoder</text>`,
    '</svg>',
    '',
  ].join('\n');
}

/** 把 XML/SVG 文本里的特殊字符转义，防止首字母含 <>&'" 时破坏 SVG 结构 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 渲染项目根 README.md：
 * - 项目简介（来自需求 goal）
 * - 文档导航（指向 docs/ 下两份文档 + 当前目录结构）
 * - 快速开始（如何在浏览器打开 + 如何让 AI 助理部署）
 * - V1 核心功能概览（同步 versionPlan 的 V1，便于人/搜索引擎一眼抓到重点）
 * README 是「项目门面」，不写就会让用户打开项目后不知道下一步该做什么。
 */
export function renderReadmeDoc(
  project: ProjectMeta,
  requirements: Requirements | null,
  plan: VersionPlan | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${sanitizeInline(project.name) || '项目'}`);
  lines.push('');

  // 一句话目标作为副标题
  const goal = sanitizeInline(requirements?.goal);
  if (goal) {
    lines.push(`> ${goal}`);
    lines.push('');
  }

  lines.push(
    '> 本项目由 [FreeCoder](https://github.com/) 通过对话自动生成。打开 `index.html` 即可在浏览器运行。',
  );
  lines.push('');

  lines.push('## 📚 文档导航');
  lines.push('');
  lines.push('| 文档 | 内容 |');
  lines.push('| --- | --- |');
  lines.push('| [📋 需求说明书](docs/requirements.md) | 用户原始需求、目标用户、核心功能、关键流程、边界设定 |');
  lines.push('| [🗂 版本分段计划](docs/version-plan.md) | V1/V2 功能切分、开发节奏 |');
  lines.push('');

  lines.push('## 🚀 快速开始');
  lines.push('');
  lines.push('这是一个**纯静态 Web 应用**，无需安装任何依赖：');
  lines.push('');
  lines.push('1. 双击打开 `index.html` —— 用浏览器即可运行');
  lines.push('2. 数据保存在浏览器本地（`localStorage`），刷新不会丢失');
  lines.push('3. 想部署到线上？回到 FreeCoder 顶部菜单点 **🚀 部署**，AI 会帮你生成部署包');
  lines.push('');
  if (requirements?.authentication && requirements.authentication !== 'none') {
    lines.push(
      '> 本项目包含登录系统（`' +
        translateAuth(requirements.authentication) +
        '`），本地运行时需要 FreeCoder 提供的登录后端；部署后会自动接入云端账号服务。',
    );
    lines.push('');
  }

  // V1 核心功能概览：从 versionPlan 取 V1，让 README 自带「首次发布能做什么」
  const v1 = plan?.versions?.[0];
  const v1Features = v1 ? v1.features.map(sanitizeInline).filter(Boolean) : [];
  if (v1 && v1Features.length > 0) {
    lines.push('## ✨ 本版本（V1）核心功能');
    lines.push('');
    const v1Desc = sanitizeInline(v1.description);
    if (v1Desc) lines.push(v1Desc);
    lines.push('');
    v1Features.forEach((feature) => lines.push(`- ${feature}`));
    lines.push('');
  }

  // 项目结构：用代码块而非树形字符，避免不同字体下错位
  lines.push('## 📁 项目结构');
  lines.push('');
  lines.push('```');
  lines.push('.');
  lines.push('├── index.html          # 应用入口');
  lines.push('├── style.css           # 样式');
  lines.push('├── app.js              # 业务逻辑');
  if (requirements?.authentication && requirements.authentication !== 'none') {
    lines.push('├── auth.js             # 登录运行时（FreeCoder 注入，请勿修改）');
    lines.push('├── server.js           # 登录后端（FreeCoder 注入，请勿修改）');
  }
  lines.push('├── README.md           # 本文件');
  lines.push('├── docs/               # 项目文档');
  lines.push('│   ├── requirements.md');
  lines.push('│   └── version-plan.md');
  lines.push('└── assets/             # 图片素材（logo / 图标等）');
  lines.push('```');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(
    `_由 FreeCoder 自动生成 · 最后更新：${formatTimestamp(project.updatedAt)}_`,
  );
  lines.push('');
  return lines.join('\n');
}

/** 写出 Markdown 到目标路径，自动 mkdir docs/。原子覆盖：先写临时文件再 rename。 */
async function writeDocFile(targetPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  // 临时文件名拼上 pid + 时间戳 + 6 位随机数，避免同毫秒并发写入时同名 tmp 互相覆盖
  const random = Math.random().toString(36).slice(2, 8);
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.${random}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf-8');
  try {
    await fs.rename(tmpPath, targetPath);
  } catch {
    // rename 失败（Windows 上偶尔目标被占用 / 跨设备） → 退回到直接覆盖，并清理临时文件
    await fs.rm(tmpPath, { force: true });
    await fs.writeFile(targetPath, content, 'utf-8');
  }
}

/**
 * 把当前需求写入 docs/requirements.md。
 * 需求尚未生成（goal 空且无核心功能）时跳过，返回 null；写入成功返回绝对路径。
 */
export async function writeRequirementsDoc(
  storage: StorageManager,
  projectId: string,
): Promise<string | null> {
  const project = await storage.getProject(projectId);
  if (!project) return null;
  const requirements = await storage.getRequirements(projectId);
  if (!requirements) return null;
  // 空需求（既没有 goal 也没有功能）不写，避免文档视图里多一份占位空文
  if (!requirements.goal?.trim() && (requirements.coreFeatures ?? []).length === 0) {
    return null;
  }
  const codePath = storage.getProjectCodePath(projectId);
  const target = requirementsDocPath(codePath);
  await writeDocFile(target, renderRequirementsDoc(project, requirements));
  return target;
}

/**
 * 把当前版本计划写入 docs/version-plan.md。
 * 版本计划尚未生成（versions 为空）时跳过。
 */
export async function writeVersionPlanDoc(
  storage: StorageManager,
  projectId: string,
): Promise<string | null> {
  const project = await storage.getProject(projectId);
  if (!project) return null;
  const plan = project.versionPlan;
  if (!plan || !plan.versions || plan.versions.length === 0) return null;
  const codePath = storage.getProjectCodePath(projectId);
  const target = versionPlanDocPath(codePath);
  await writeDocFile(target, renderVersionPlanDoc(project, plan));
  return target;
}

/**
 * 把项目门面 README.md 写入项目根。
 * 需求或项目名缺失时仍能生成（标题 + 部署提示），避免空项目初次进入【文档】
 * 连一份 README 都没有。
 *
 * 写入策略：仅当 README 不存在，或项目元数据在 README 之后被更新时才覆盖。
 * 这样：
 * - 老项目首次进入【文档】会被回填
 * - confirm / planner.onDone / confirmPlan 后元数据更新会触发 README 刷新
 * - 用户手工编辑过的 README 不会被静默覆盖
 * - 不会因为 listDocuments 每次都触发回填而无意义重写（性能 + 编辑保护）
 */
export async function writeReadmeDoc(
  storage: StorageManager,
  projectId: string,
): Promise<string | null> {
  const project = await storage.getProject(projectId);
  if (!project) return null;
  const requirements = await storage.getRequirements(projectId);
  const plan = project.versionPlan ?? null;
  const codePath = storage.getProjectCodePath(projectId);
  const target = readmeDocPath(codePath);

  // 已有 README 且比项目元数据新 → 跳过，尊重用户的手工编辑
  try {
    const [stat, meta] = await Promise.all([
      fs.stat(target),
      storage.getProject(projectId),
    ]);
    const metaUpdatedAt = meta?.updatedAt ? new Date(meta.updatedAt).getTime() : 0;
    if (stat.mtimeMs >= metaUpdatedAt) {
      return target;
    }
  } catch {
    /* README 不存在 → 继续写 */
  }

  await writeDocFile(target, renderReadmeDoc(project, requirements, plan));
  return target;
}

/**
 * 兜底写一份占位 logo.svg 到 assets/。
 * 设计取舍：**绝不覆盖**已存在的文件。DSH 通常会按需求生成自定义 logo/icon；
 * 主进程只在用户没让 DSH 生成（或 DSH 没生成）时补一张默认图，避免【文档】Tab
 * 的「图片素材」分类永远为空。
 *
 * 用 `wx` 标志（O_EXCL）原子创建，规避 stat-then-write 在并发场景下的 TOCTOU
 * 竞态：并发两个调用方都 stat 不存在 → 都试图写入 → 后写者覆盖先写者。wx 让
 * 内核保证"已存在则直接拒绝"，并发自然收敛到先到的那个胜出，后到的捕获
 * EEXIST 后返回 null。
 */
export async function writeLogoPlaceholder(
  storage: StorageManager,
  projectId: string,
): Promise<string | null> {
  const project = await storage.getProject(projectId);
  if (!project) return null;
  const codePath = storage.getProjectCodePath(projectId);
  const target = logoPlaceholderPath(codePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(target, renderLogoPlaceholder(project), {
      encoding: 'utf-8',
      flag: 'wx',
    });
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
}

/**
 * 老项目升级到本版本后首次进入【文档】时：项目已有结构化数据但 docs/ 下还没有
 * requirements.md / version-plan.md，根目录也没有 README.md。这里做一次"惰性回填"：
 * - 仅当项目状态不是 draft 时尝试（draft 阶段需求还在变化，重写没意义）
 * - 缺哪个补哪个，不会覆盖用户已经手工编辑过的 docs（先 stat 后写入）
 * - README 由 writeReadmeDoc 自身根据 mtime vs 元数据 updatedAt 决定是否刷新
 * - logo 仅在缺失时补一份（绝不覆盖 DSH 已生成的资源）
 */
export async function backfillProjectDocs(
  storage: StorageManager,
  projectId: string,
): Promise<{
  requirements: string | null;
  versionPlan: string | null;
  readme: string | null;
  logo: string | null;
}> {
  const project = await storage.getProject(projectId);
  if (!project) return { requirements: null, versionPlan: null, readme: null, logo: null };
  if (project.status === 'draft') {
    return { requirements: null, versionPlan: null, readme: null, logo: null };
  }

  const codePath = storage.getProjectCodePath(projectId);
  const reqTarget = requirementsDocPath(codePath);
  const planTarget = versionPlanDocPath(codePath);

  const results = {
    requirements: null as string | null,
    versionPlan: null as string | null,
    readme: null as string | null,
    logo: null as string | null,
  };

  // 用 try/catch 包裹 stat：文件不存在时 fs.stat 会 reject，这是正常分支
  let reqExists = false;
  try {
    await fs.stat(reqTarget);
    reqExists = true;
  } catch {
    reqExists = false;
  }
  if (!reqExists) {
    try {
      results.requirements = await writeRequirementsDoc(storage, projectId);
    } catch (error) {
      console.warn('[FreeCoder] 回填需求文档失败：', error);
    }
  }

  let planExists = false;
  try {
    await fs.stat(planTarget);
    planExists = true;
  } catch {
    planExists = false;
  }
  if (!planExists) {
    try {
      results.versionPlan = await writeVersionPlanDoc(storage, projectId);
    } catch (error) {
      console.warn('[FreeCoder] 回填版本计划文档失败：', error);
    }
  }

  // README 由 writeReadmeDoc 自身根据 mtime vs 项目元数据 updatedAt 决定是否刷新；
  // 这样 listDocuments 每次回填不会无意义重写，老项目首次进入或元数据变更才会真正写入。
  try {
    results.readme = await writeReadmeDoc(storage, projectId);
  } catch (error) {
    console.warn('[FreeCoder] 回填 README 失败：', error);
  }

  // Logo 仅在 assets/logo.svg 缺失时补一份（writeLogoPlaceholder 内部用 wx 原子创建）
  try {
    results.logo = await writeLogoPlaceholder(storage, projectId);
  } catch (error) {
    console.warn('[FreeCoder] 回填占位 logo 失败：', error);
  }

  return results;
}
