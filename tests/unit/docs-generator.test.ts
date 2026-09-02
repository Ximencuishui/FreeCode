/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  backfillProjectDocs,
  logoPlaceholderPath,
  readmeDocPath,
  renderLogoPlaceholder,
  renderReadmeDoc,
  renderRequirementsDoc,
  renderVersionPlanDoc,
  requirementsDocPath,
  versionPlanDocPath,
  writeLogoPlaceholder,
  writeReadmeDoc,
  writeRequirementsDoc,
  writeVersionPlanDoc,
} from '../../src/main/dev/docsGenerator';
import type { StorageManager, ProjectMeta, Requirements } from '../../src/main/storage/types';
import type { VersionPlan } from '../../src/shared/types/project';

/** 构造一个最小可用的 StorageManager mock（只实现 docsGenerator 用到的接口） */
function createStorage(
  project: ProjectMeta,
  requirements: Requirements | null,
  codePath: string,
): StorageManager {
  return {
    getProject: async () => project,
    getRequirements: async () => requirements,
    getProjectCodePath: () => codePath,
  } as unknown as StorageManager;
}

const PROJECT: ProjectMeta = {
  id: 'proj-docs',
  name: '示例项目',
  status: 'ready',
  createdAt: '2026-08-24T04:48:57.000Z',
  updatedAt: '2026-09-01T12:51:55.000Z',
  lastOpenedAt: '2026-09-01T12:51:55.000Z',
  codePath: './code',
  exportCount: 0,
  totalChatMessages: 10,
  versionPlan: {
    versions: [
      {
        label: 'V1',
        description: '先把记账跑通',
        features: ['记一笔', '看列表'],
      },
      {
        label: 'V2',
        description: '补齐报表与导出',
        features: ['月度报表', '导出 CSV'],
      },
    ],
  },
};

const REQUIREMENTS: Requirements = {
  projectId: 'proj-docs',
  version: '1.0',
  confirmed: true,
  confirmedAt: '2026-08-24T13:44:11.000Z',
  goal: '做一个记账小程序',
  targetUsers: '个人用户',
  coreFeatures: ['记一笔', '看列表', '月度报表'],
  useScenarios: '个人日常记账',
  dataRequirements: ['账单记录'],
  visualStyle: '简洁',
  platform: 'web',
  pages: ['首页', '添加', '统计'],
  layout: '顶部导航 + 内容区',
  styleFeeling: '简洁清爽',
  device: 'mobile',
  keyFlows: ['添加后立即刷新'],
  authentication: 'none',
  usageScale: 'solo',
  exportFeatures: ['导出 CSV'],
  uiLanguage: 'zh-CN',
  history: [{ version: 1, timestamp: '2026-08-24T13:44:11.000Z', changes: 'AI 助理生成需求' }],
  updatedAt: '2026-08-24T13:44:11.000Z',
};

describe('docsGenerator', () => {
  let root: string;
  let codePath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-docs-gen-'));
    codePath = path.join(root, 'code');
    await fs.mkdir(codePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('renderRequirementsDoc 输出包含章节标题与字段', () => {
    const md = renderRequirementsDoc(PROJECT, REQUIREMENTS);
    expect(md).toContain('# 示例项目 — 需求说明书');
    expect(md).toContain('## 1. 一句话目标');
    expect(md).toContain('## 3. 核心功能');
    expect(md).toContain('## 9. 边界设定');
    expect(md).toContain('- 记一笔');
    // 中文翻译而非裸英文
    expect(md).toContain('手机');
    expect(md).not.toContain('device: mobile');
    expect(md).toContain('docs/requirements.md');
  });

  it('renderVersionPlanDoc 把 V1/V2 拆为独立章节', () => {
    const md = renderVersionPlanDoc(PROJECT, PROJECT.versionPlan as VersionPlan);
    expect(md).toContain('# 示例项目 — 版本分段计划');
    expect(md).toContain('## 1. V1');
    expect(md).toContain('## 2. V2');
    expect(md).toContain('最小可用版本');
    expect(md).toContain('- 记一笔');
    expect(md).toContain('docs/version-plan.md');
  });

  it('writeRequirementsDoc 写入 docs/requirements.md', async () => {
    const target = await writeRequirementsDoc(createStorage(PROJECT, REQUIREMENTS, codePath), 'proj-docs');
    expect(target).toBe(requirementsDocPath(codePath));
    const content = await fs.readFile(target!, 'utf-8');
    expect(content).toContain('做一个记账小程序');
  });

  it('writeVersionPlanDoc 写入 docs/version-plan.md', async () => {
    const target = await writeVersionPlanDoc(createStorage(PROJECT, REQUIREMENTS, codePath), 'proj-docs');
    expect(target).toBe(versionPlanDocPath(codePath));
    const content = await fs.readFile(target!, 'utf-8');
    expect(content).toContain('先把记账跑通');
  });

  it('需求为空时不写文档（避免空文）', async () => {
    const empty: Requirements = {
      ...REQUIREMENTS,
      goal: '',
      coreFeatures: [],
    };
    const target = await writeRequirementsDoc(
      createStorage(PROJECT, empty, codePath),
      'proj-docs',
    );
    expect(target).toBeNull();
    // 不应创建 docs 目录
    await expect(fs.stat(path.join(codePath, 'docs'))).rejects.toThrow();
  });

  it('draft 状态下 backfillProjectDocs 跳过，避免覆盖正在变化的需求', async () => {
    const draftProject: ProjectMeta = { ...PROJECT, status: 'draft' };
    const result = await backfillProjectDocs(
      createStorage(draftProject, REQUIREMENTS, codePath),
      'proj-docs',
    );
    expect(result).toEqual({ requirements: null, versionPlan: null, readme: null, logo: null });
    await expect(fs.stat(requirementsDocPath(codePath))).rejects.toThrow();
    await expect(fs.stat(readmeDocPath(codePath))).rejects.toThrow();
    await expect(fs.stat(logoPlaceholderPath(codePath))).rejects.toThrow();
  });

  it('老项目升级后首次 backfill 自动补全 README + 需求 + 版本计划 + 占位 logo', async () => {
    const result = await backfillProjectDocs(
      createStorage(PROJECT, REQUIREMENTS, codePath),
      'proj-docs',
    );
    expect(result.requirements).toBe(requirementsDocPath(codePath));
    expect(result.versionPlan).toBe(versionPlanDocPath(codePath));
    expect(result.readme).toBe(readmeDocPath(codePath));
    // DSH 未生成任何图片 → 兜底 logo 应该被写入
    expect(result.logo).toBe(logoPlaceholderPath(codePath));
    const readme = await fs.readFile(result.readme!, 'utf-8');
    expect(readme).toContain('# 示例项目');
    expect(readme).toContain('docs/requirements.md');
    expect(readme).toContain('docs/version-plan.md');
    // 登录模式 = none → 不应该出现 auth.js / server.js 描述
    expect(readme).not.toContain('auth.js');
  });

  it('backfill 不会覆盖用户已经手工编辑过的需求/版本计划文档（但 README 始终刷新）', async () => {
    // 模拟"已经有一份手工维护的文档"
    const existingReqPath = requirementsDocPath(codePath);
    const existingPlanPath = versionPlanDocPath(codePath);
    await fs.mkdir(path.dirname(existingReqPath), { recursive: true });
    await fs.writeFile(existingReqPath, '# 用户手动维护的 requirements', 'utf-8');
    await fs.writeFile(existingPlanPath, '# 用户手动维护的 version-plan', 'utf-8');

    const result = await backfillProjectDocs(
      createStorage(PROJECT, REQUIREMENTS, codePath),
      'proj-docs',
    );
    // 手工维护的 docs 不被覆盖；README 是动态索引，始终刷新
    expect(result.requirements).toBeNull();
    expect(result.versionPlan).toBeNull();
    expect(result.readme).toBe(readmeDocPath(codePath));
    expect(await fs.readFile(existingReqPath, 'utf-8')).toBe('# 用户手动维护的 requirements');
    expect(await fs.readFile(existingPlanPath, 'utf-8')).toBe('# 用户手动维护的 version-plan');
  });

  it('backfill 不会覆盖 DSH 已生成的 logo.svg', async () => {
    // 模拟"DSH 已经生成了一张 logo"
    const existingLogoPath = logoPlaceholderPath(codePath);
    await fs.mkdir(path.dirname(existingLogoPath), { recursive: true });
    await fs.writeFile(existingLogoPath, '<svg>DSH 自定义 logo</svg>', 'utf-8');

    const result = await backfillProjectDocs(
      createStorage(PROJECT, REQUIREMENTS, codePath),
      'proj-docs',
    );
    // logo 已存在 → 不回填
    expect(result.logo).toBeNull();
    expect(await fs.readFile(existingLogoPath, 'utf-8')).toBe('<svg>DSH 自定义 logo</svg>');
  });

  // ===== README =====

  it('renderReadmeDoc 包含项目名 + 文档导航 + 快速开始 + V1 核心功能', () => {
    const md = renderReadmeDoc(PROJECT, REQUIREMENTS, PROJECT.versionPlan as VersionPlan);
    expect(md).toContain('# 示例项目');
    expect(md).toContain('> 做一个记账小程序'); // 副标题 = goal
    expect(md).toContain('## 📚 文档导航');
    expect(md).toContain('[📋 需求说明书](docs/requirements.md)');
    expect(md).toContain('## 🚀 快速开始');
    expect(md).toContain('## ✨ 本版本（V1）核心功能');
    expect(md).toContain('- 记一笔');
    expect(md).toContain('## 📁 项目结构');
  });

  it('登录模式下 README 提示有登录后端', () => {
    const authReq: Requirements = { ...REQUIREMENTS, authentication: 'password' };
    const md = renderReadmeDoc(PROJECT, authReq, PROJECT.versionPlan as VersionPlan);
    expect(md).toContain('auth.js');
    expect(md).toContain('server.js');
    expect(md).toContain('登录系统');
  });

  it('writeReadmeDoc 在 README 缺失时写入', async () => {
    const target = readmeDocPath(codePath);
    const written = await writeReadmeDoc(
      createStorage(PROJECT, REQUIREMENTS, codePath),
      'proj-docs',
    );
    expect(written).toBe(target);
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toContain('# 示例项目');
    expect(content).toContain('docs/requirements.md');
  });

  it('writeReadmeDoc 已存在且比元数据新时跳过写入（尊重用户手工编辑）', async () => {
    const target = readmeDocPath(codePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // 模拟"用户手工编辑过的 README"，mtime 比项目 updatedAt 晚很多
    await fs.writeFile(target, '# 用户手工维护的 README', 'utf-8');
    const future = Date.now() + 10_000;
    await fs.utimes(target, future / 1000, future / 1000);

    const written = await writeReadmeDoc(
      createStorage(PROJECT, REQUIREMENTS, codePath),
      'proj-docs',
    );
    expect(written).toBe(target);
    // 关键：内容仍是用户手工版，未被覆盖
    expect(await fs.readFile(target, 'utf-8')).toBe('# 用户手工维护的 README');
  });

  it('writeReadmeDoc 当项目元数据晚于 README mtime 时仍刷新', async () => {
    const target = readmeDocPath(codePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '# 旧的 README', 'utf-8');
    // 把 README 的 mtime 调到"很早以前"（比 PROJECT.updatedAt 更早）
    const past = Date.parse(PROJECT.updatedAt) / 1000 - 60;
    await fs.utimes(target, past, past);

    const written = await writeReadmeDoc(
      createStorage(PROJECT, REQUIREMENTS, codePath),
      'proj-docs',
    );
    expect(written).toBe(target);
    // 触发刷新：内容已被覆盖为新版
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toContain('# 示例项目');
    expect(content).not.toBe('# 旧的 README');
  });

  it('renderReadmeDoc 在缺需求/缺 plan 时仍可生成（标题 + 文档导航 + 快速开始）', () => {
    const md = renderReadmeDoc(PROJECT, null, null);
    expect(md).toContain('# 示例项目');
    expect(md).toContain('## 📚 文档导航');
    expect(md).toContain('## 🚀 快速开始');
    // V1 不存在 → 不渲染
    expect(md).not.toContain('本版本（V1）');
  });

  // ===== 占位 logo =====

  it('renderLogoPlaceholder 生成合法 SVG，首字母随项目名变化', () => {
    const svg = renderLogoPlaceholder(PROJECT);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 128 128"');
    // 项目名"示例项目" → 首字"示"
    expect(svg).toContain('>示<');
    expect(svg).toContain('FreeCoder');
    // 必须有渐变定义
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('stop-color="hsl(');
  });

  it('renderLogoPlaceholder 对英文项目名取大写首字母', () => {
    const englishProject: ProjectMeta = { ...PROJECT, name: 'DeepGEO' };
    const svg = renderLogoPlaceholder(englishProject);
    expect(svg).toContain('>D<');
  });

  it('renderLogoPlaceholder 对特殊字符做 XML 转义', () => {
    // 选一个能让首字符通过 deriveLogoInitial 过滤、又含危险字符的项目名：
    // "1&2" 首字符 "1"（数字）通过；正文里的 "&" 在 SVG text 节点里必须转义。
    // 我们通过检查"非首字符的 & 不可能出现在 text 节点"间接验证转义存在；
    // 更直接的回归覆盖是单元测试 escapeXml（未导出但逻辑独立），
    // 这里至少验证 SVG 文本里没有裸 <script> / 未闭合的标签。
    const evilProject: ProjectMeta = { ...PROJECT, name: '<<script>>' };
    const svg = renderLogoPlaceholder(evilProject);
    // 不会暴露任何 <script> 序列（即使名字里有，deriveLogoInitial 也会替换为 ★）
    expect(svg).not.toMatch(/<script/i);
    // 整段 SVG 必须有且仅有一个 <text> 节点 + 自闭合结构，没有未闭合的孤儿标签
    expect(svg).toContain('<text x="64" y="78"');
    expect(svg).toContain('<text x="64" y="108"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('writeLogoPlaceholder 仅在缺失时写入，已存在则跳过', async () => {
    const target = logoPlaceholderPath(codePath);

    // 第一次：缺失 → 写入
    const first = await writeLogoPlaceholder(
      createStorage(PROJECT, REQUIREMENTS, codePath),
      'proj-docs',
    );
    expect(first).toBe(target);
    const original = await fs.readFile(target, 'utf-8');

    // 第二次：已存在 → 跳过
    const second = await writeLogoPlaceholder(
      createStorage(PROJECT, REQUIREMENTS, codePath),
      'proj-docs',
    );
    expect(second).toBeNull();
    const after = await fs.readFile(target, 'utf-8');
    expect(after).toBe(original); // 内容未变
  });

  it('writeLogoPlaceholder 并发调用：仅第一个成功，其余返回 null（wx 原子创建）', async () => {
    const target = logoPlaceholderPath(codePath);
    // 并发 3 次写同一目标
    const results = await Promise.all([
      writeLogoPlaceholder(createStorage(PROJECT, REQUIREMENTS, codePath), 'proj-docs'),
      writeLogoPlaceholder(createStorage(PROJECT, REQUIREMENTS, codePath), 'proj-docs'),
      writeLogoPlaceholder(createStorage(PROJECT, REQUIREMENTS, codePath), 'proj-docs'),
    ]);
    // 仅第一个返回 target，其余捕获 EEXIST 返回 null
    const successes = results.filter((r) => r !== null);
    const skipped = results.filter((r) => r === null);
    expect(successes).toEqual([target]);
    expect(skipped).toHaveLength(2);
    // 文件确实被写入且只有一份
    const content = await fs.readFile(target, 'utf-8');
    expect(content).toContain('<svg');
  });

  // ===== Markdown 注入防御 =====

  it('项目名含换行 + ## 注入时，不会破坏标题层级', () => {
    const evilProject: ProjectMeta = {
      ...PROJECT,
      name: '示例项目\n## 注入的二级标题\n',
    };
    const md = renderRequirementsDoc(evilProject, REQUIREMENTS);
    // 标题仍为单行；"## 注入"被 sanitizeInline 折叠成单行塞进 # 标题里
    expect(md).toMatch(/^# 示例项目 注入的二级标题 — 需求说明书$/m);
    // 文档里不能凭空多出一个 ## 章节（仅来自我们的 10 个固定章节）
    const headings = md.match(/^#{1,6}\s/gm) ?? [];
    expect(headings.length).toBe(11); // 1 个 # + 10 个 ##
  });

  it('goal 含换行 / 反引号 → 副标题单行化', () => {
    const evilReq: Requirements = {
      ...REQUIREMENTS,
      goal: '做一个记账小程序\n`内联代码`\n[坏链接](https://evil.com)',
    };
    const md = renderReadmeDoc(PROJECT, evilReq, null);
    // 副标题在 README 第一段 > 引用里，必须是单行
    const subtitleLine = md.split('\n').find((line) => line.startsWith('> '));
    expect(subtitleLine).toBeDefined();
    expect(subtitleLine).not.toContain('\n');
    // 反引号、链接语法都被原样保留为字面字符（不会被破坏），但不再含换行
    expect(subtitleLine).toContain('`内联代码`');
    expect(subtitleLine).toContain('https://evil.com');
  });

  it('feature 列表项为空字符串 → 被过滤，避免空 - 行', () => {
    const evilReq: Requirements = {
      ...REQUIREMENTS,
      coreFeatures: ['记一笔', '', '   ', '看列表'],
    };
    const md = renderRequirementsDoc(PROJECT, evilReq);
    // 不应该出现孤立的 "- " 项
    expect(md).not.toMatch(/^- $/m);
    // 3 个有效项仍保留
    expect(md).toMatch(/^- 记一笔$/m);
    expect(md).toMatch(/^- 看列表$/m);
  });

  // ===== Unicode 首字母覆盖 =====

  it('renderLogoPlaceholder 支持韩文、日文、带音标拉丁字母、数字首字符', () => {
    expect(renderLogoPlaceholder({ ...PROJECT, name: '가계부' })).toContain('>가<');
    expect(renderLogoPlaceholder({ ...PROJECT, name: 'メモ帳' })).toContain('>メ<');
    expect(renderLogoPlaceholder({ ...PROJECT, name: 'Élan' })).toContain('>É<');
    expect(renderLogoPlaceholder({ ...PROJECT, name: '2026 财年' })).toContain('>2<');
    // emoji 开头 → 兜底 ★
    const svg = renderLogoPlaceholder({ ...PROJECT, name: '🎉派对' });
    expect(svg).toContain('>★<');
  });

  // ===== writeRequirementsDoc 边界 =====

  it('writeRequirementsDoc 当 goal 为空但有功能时仍写入', async () => {
    // 旧逻辑：!goal.trim() && features.length === 0 才跳过；现在保留这个行为，单独验证。
    const target = await writeRequirementsDoc(
      createStorage(
        PROJECT,
        { ...REQUIREMENTS, goal: '', coreFeatures: ['记一笔'] },
        codePath,
      ),
      'proj-docs',
    );
    expect(target).toBe(requirementsDocPath(codePath));
    const content = await fs.readFile(target!, 'utf-8');
    expect(content).toContain('- 记一笔');
  });
});
