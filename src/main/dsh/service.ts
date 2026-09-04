import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DSHProcessManager, type DSHExitInfo, type DSHStatus } from './manager';
import { DSHError } from './errors';
import { sanitizeLog } from '../security/encryption';
import type { LlmProviderKind } from '../../shared/types/settings';
import type { DSHState, DSHRunStatus } from '../../shared/types/dsh';

/**
 * DSH 高层服务：面向 FreeCoder 业务的一次性任务执行。
 * 基于 `dsh --profile headless "task"` 模式（已验证：输出最终回复到 stdout 后退出）。
 * 多轮对话的会话保持策略在 WP-08 深入后于 WP-10 落地。
 *
 * 打包后的应用内置 dsh CLI（resources/dsh/）+ Node 运行时（resources/node/），
 * 用内置 node.exe 运行 dsh，无需用户额外安装 dsh（scripts/bundle-dsh.mjs 生成）。
 */

export interface DSHServiceOptions {
  /** dsh 启动命令（默认 resolveDshLaunch()：环境变量 → 内置运行时 → PATH） */
  command?: string[] | DSHLaunch;
  /** DSH_HOME 覆盖 */
  dshHome?: string;
  /**
   * 大模型凭据提供者：返回本地加密存储的 key 与提供商配置。
   * 注入子进程环境变量（provider 的 apiKeyEnv 字段）：
   * deepseek → DEEPSEEK_API_KEY；openai-compatible → OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL。
   */
  apiKeyProvider?: () => Promise<DSHCredentials | null>;
}

export interface DSHCredentials {
  apiKey: string;
  provider: LlmProviderKind;
  baseUrl?: string;
  model?: string;
}

export interface DSHResult {
  /** headless 最终回复（stdout 最后一条非空文本） */
  reply: string;
  /** 模型推理过程（思考过程；headless runner 补丁后以信封输出，可能为空） */
  reasoning?: string;
  /** 进程退出码（0=任务完成，1=未完成） */
  exitCode: number;
}

/** dsh 启动描述：argv 可为 [内置node.exe, bin.js, ...]（打包环境）或 [dsh]（PATH 环境） */
export interface DSHLaunch {
  /** 启动命令 argv */
  argv: string[];
  /** 附加环境变量（预留；内置运行时当前不需要额外变量） */
  env?: NodeJS.ProcessEnv;
  /** DSH_HOME 覆盖 */
  dshHome?: string;
}

export type DSHLaunchSource = 'env' | 'bundled' | 'path' | 'custom' | 'missing';

export interface DSHLaunchDescriptor extends DSHLaunch {
  /** 命令来源，用于错误提示与健康检查 */
  source: DSHLaunchSource;
  /** 人类可读的说明 */
  description: string;
}

/** Electron 主进程在打包后注入的路径（@types/node 未声明，此处显式标注） */
type ElectronProcess = NodeJS.Process & { resourcesPath?: string };

/** dsh 启动入口缺失时的统一文案（徽章主消息）。
 *  v3.2.2 P0-x：原文案「未检测到 DeepSeek Harness（dsh）启动入口」句式重复、对非技术
 *  用户不友好。这里简化为「dsh 引擎未找到」——一眼能看出"没装"，具体解决路径放在
 *  resolveDshLaunch() 的 description 里（徽章渲染为括号内补充说明）。
 *  computeState() 和 checkHealth() 共享这一个常量，避免双文案飘移。 */
const MISSING_LAUNCH_MESSAGE = 'dsh 引擎未找到';

/**
 * 应用资源目录。
 * - 打包后：<app>/resources（process.resourcesPath）—— 最优先。
 * - 开发态/未打包：仓库根/resources（process.resourcesPath 指向 Electron 自身的 dist/resources，
 *   里面没有内置 dsh）。dev 态下 __dirname 的层级取决于 vite 是把代码 bundle 到
 *   dist/main/index.js 还是打出独立的 dist/main/dsh/service.js，所以用「固定深度 =
 *   仓库根」+ 「process.cwd() 兜底」两条候选，任意一种 dev 启动方式都能命中。
 */
function getResourcesPath(): string {
  const res = (process as ElectronProcess).resourcesPath ?? '';
  if (res && fs.existsSync(path.join(res, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
    return res;
  }
  // dev 候选：从仓库根/resources 找。__dirname 在源码态（src/main/dsh）和编译态
  // （dist/main/dsh）深度不同，但 「仓库根」都是 src/main/dsh 或 dist/main/dsh 往上三层，
  // 统一用 '../../../' 即可。process.cwd() 兜底是给 `pnpm exec electron .` 或 monorepo
  // 子目录场景用的——那时 __dirname 已被 build 工具重定位，但 cwd 仍是仓库根。
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'resources'),
    path.resolve(process.cwd(), 'resources'),
  ];
  for (const dev of candidates) {
    if (fs.existsSync(path.join(dev, 'dsh'))) return dev;
  }
  return res;
}

/** 内置 dsh CLI 入口（打包后位于 <resources>/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js） */
function bundledBinPath(): string {
  const resourcesPath = getResourcesPath();
  if (!resourcesPath) return '';
  return path.join(resourcesPath, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
}

/** 内置 Node 运行时（打包后位于 <resources>/node/node.exe） */
function bundledNodePath(): string {
  const resourcesPath = getResourcesPath();
  if (!resourcesPath) return '';
  return path.join(resourcesPath, 'node', 'node.exe');
}

/** 在 PATH 中查找可执行文件（Windows 按 PATHEXT 常见扩展名搜索） */
export function findOnPath(bin: string): string | null {
  // Windows 上优先真实可执行扩展名（.cmd/.exe/.bat），避免命中无扩展名的 POSIX 脚本
  // （如 pnpm 生成的 .bin/dsh，node spawn 无法直接执行导致 ENOENT）
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${bin}${ext}`);
      try {
        fs.accessSync(candidate);
        return candidate;
      } catch {
        /* 继续搜索 */
      }
    }
  }
  return null;
}

/**
 * 解析 dsh 启动命令，优先级：
 * 1. FREECODER_DSH_COMMAND 环境变量（支持 JSON 数组，如 ["node","C:/.../bin.js"]；也兼容空格分隔）
 * 2. 应用内置运行时（scripts/bundle-dsh.mjs 生成 resources/dsh/ + resources/node/）。
 *    headless 捆绑包会 import node-pty（按 Node ABI 预编译的原生模块），必须用内置
 *    真实 node.exe 运行，不能走 ELECTRON_RUN_AS_NODE（Electron 的 ABI 不兼容）。
 * 3. PATH 中的 dsh（开发环境）
 * 4. 均不可用 → source='missing'，由调用方给出明确错误提示
 */
export function resolveDshLaunch(): DSHLaunchDescriptor {
  const envCmd = process.env.FREECODER_DSH_COMMAND;
  if (envCmd?.trim()) {
    try {
      const parsed = JSON.parse(envCmd);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return {
          argv: parsed as string[],
          source: 'env',
          description: 'FREECODER_DSH_COMMAND 自定义命令',
        };
      }
    } catch {
      /* 不是 JSON，退化到空格分隔 */
    }
    return {
      argv: envCmd.trim().split(/\s+/),
      source: 'env',
      description: 'FREECODER_DSH_COMMAND 自定义命令',
    };
  }

  const bundled = bundledBinPath();
  const bundledNode = bundledNodePath();
  if (bundled && bundledNode && fs.existsSync(bundled) && fs.existsSync(bundledNode)) {
    return {
      argv: [bundledNode, bundled],
      source: 'bundled',
      description: '应用内置 DeepSeek Harness（dsh）运行时',
    };
  }

  const found = findOnPath('dsh');
  if (found) {
    return {
      argv: [found],
      source: 'path',
      description: `PATH 中的 dsh（${found}）`,
    };
  }

  return {
    argv: ['dsh'],
    source: 'missing',
    // v3.2.2 P0-x：原文案「未找到 dsh 命令，也未检测到内置运行时」同时混了
    // 「启动入口」/「内置运行时」两个开发者术语，对非技术用户不可读。
    // 徽章里与 MISSING_LAUNCH_MESSAGE 合成展示，这里只放解决路径。
    // FreeCoder 承诺自带 dsh（终端用户安装包应在 resources/dsh/ 内置 dsh 运行时），
    // 所以 missing 态的解决路径只指向"重装"——通常是安装包漏打 resources/dsh 的
    // 不完整构建，重装最新桌面端安装包即可恢复。
    // 不再保留「在系统中安装 dsh 命令」分支：与产品定位矛盾，且对终端用户无意义。
    description: '请重新安装 FreeCoder',
  };
}

/** 兼容旧接口：仅返回 argv（等价 resolveDshLaunch().argv） */
export function resolveDshCommand(): string[] {
  return resolveDshLaunch().argv;
}

/**
 * 从 headless stdout 提取最终回复（保留所有非空文本行）。
 *
 * headless runner 在两种场景下都不写入 `<<<FC_REASONING_START>>>` 信封：
 *   - 旧版 dsh（只输出最终回复，没有 reasoning marker）
 *   - 新版 dsh 但本次没产生推理流（直答型任务）
 * 这两种情况下 stdout 末尾就是 AI 的完整多行回复（含「请选择：」+ A/B/C/D/E 选项、
 * 「```json」需求卡片、Markdown 等）。如果继续按「最后一条非空行」截取，会把
 * 多行引导式对话截成只有最后一个选项——典型 Bug：用户问「做个小程序」，
 * AI 完整回复含 5 个选项 + 引导语，但渲染层只看到「E. 其他（告诉我具体是啥）」，
 * 像是 AI 没进入引导式需求分析。
 *
 * 修复：fallback 路径返回完整多行 stdout（剔除空行 + FC_* marker 噪音行），
 * 让「多行引导式对话」与「JSON 需求卡片」都能完整呈现给用户。
 */
export function extractLastReply(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

/**
 * 把 stdout 中的 FC_* marker 行剔除，返回剩余正文（多行保留）。
 * 兜底路径（无信封）用此函数拿到完整多行回复，避免只取最后一行造成引导式对话被截断。
 */
function stripMarkerLines(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('<<<FC_'))
    .join('\n')
    .trim();
}

/** 推理内容输出信封标记（与 headless runner 补丁约定；无补丁时输出不含信封） */
const REASONING_START = '<<<FC_REASONING_START>>>';
const REASONING_END = '<<<FC_REASONING_END>>>';
/** 实时推理增量行前缀（headless runner 补丁逐条输出，JSON 编码） */
const REASONING_STREAM = '<<<FC_REASONING_STREAM>>>';
/** 实时工具调用行前缀（开发进度报告：写文件/跑命令/测试等） */
const TOOL_CALL = '<<<FC_TOOL_CALL>>>';
/** 实时工具执行结果行前缀（"开发团队怎么说"：已完成/测试通过等） */
const TOOL_RESULT = '<<<FC_TOOL_RESULT>>>';

/** 文本截断（友好错误提示限制长度，避免 user-visible message 过长） */
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 检测 DSH 子进程把大模型 API 错误透传到 stdout 的几种已知形式。
 *  返回 null 表示不是错误（当作正常回复）。
 *  返回 `{code, message}` 时调用方应拋出 DSHError，message 为已翻译为中文的友好提示。
 *
 *  已知错误模式（生产中观测到的示例）：
 *  1. dsh 内部 shell 标签："sh: RATE_LIMIT: 429 {\"type\":\"error\",...}"
 *  2. 直接是 Anthropic 错误 JSON（无 sh: 前缀）
 *  3. 裸 429 + rate_limit 关键字
 */
export function detectApiError(reply: string): { code: 'RATE_LIMIT'; message: string } | null {
  const text = reply.trim();
  if (!text) return null;

  // 1. Anthropic / 通用大模型错误 JSON：{"type":"error","error":{"type":"...","message":"..."}}
  //    message 可能含转义双引号，所以用 [\s\S]*? 非贪婪匹配
  const jsonMatch = text.match(/\{\s*"type"\s*:\s*"error"[\s\S]*?"message"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (jsonMatch) {
    // 还原常见 JSON 转义，让用户看到的是真实错误（而非 \"...\")
    const raw = jsonMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ');
    return { code: 'RATE_LIMIT', message: friendlyApiMessage(raw, text) };
  }

  // 2. dsh 内部 shell 错误标签：sh: <LABEL>: <status> <body>
  //    例：sh: RATE_LIMIT: 429 {...}
  if (/^sh:\s*[A-Z_]+\s*:/i.test(text)) {
    return { code: 'RATE_LIMIT', message: friendlyShellError(text) };
  }

  // 3. 退化匹配：文本中出现 RATE_LIMIT / 429 + rate limit 关键字组合
  if (/\bRATE_LIMIT\b/i.test(text) || /\bHTTP\s*429\b|\bstatus[:\s]+429\b|\bcode[:\s]+429\b/i.test(text)) {
    return { code: 'RATE_LIMIT', message: friendlyShellError(text) };
  }

  return null;
}

/** 把大模型 API 返回的错误文本翻译为对用户友好的中文（带截断后的原始信息便于排查） */
export function friendlyApiMessage(raw: string, full: string): string {
  const tip = '请稍后再试，或在右上角「⚙ 设置」中更换 API Key / 模型套餐。';
  if (/rate.?limit|quota|额度|用量|套餐/i.test(raw)) {
    return `大模型 API 触发了速率/额度限制（${truncate(raw, 120)}）。${tip}`;
  }
  if (/overloaded|too\s*many|busy/i.test(raw)) {
    return `大模型 API 服务繁忙（${truncate(raw, 120)}）。请稍后再试。`;
  }
  if (/auth|invalid.*key|api[_-\s]*key|unauthorized|forbidden|\b401\b|\b403\b/i.test(raw)) {
    return `大模型 API Key 无效或已过期（${truncate(raw, 120)}）。请在「⚙ 设置」中检查 API Key。`;
  }
  return `大模型 API 返回了错误：${truncate(full, 200)}`;
}

/** 把 dsh 内部 shell 错误标签（如 sh: RATE_LIMIT: 429 ...）翻译为友好中文 */
export function friendlyShellError(text: string): string {
  const labelMatch = text.match(/^sh:\s*([A-Z_]+)\s*:\s*(\d{3})?\s*([\s\S]*)$/i);
  const label = labelMatch?.[1]?.toUpperCase();
  const status = labelMatch?.[2];
  const body = labelMatch?.[3] ?? text;
  const hintBody = truncate(body.trim(), 160);

  if (label === 'RATE_LIMIT') {
    return `大模型 API 触发了速率/额度限制（HTTP ${status ?? '429'}${hintBody ? `：${hintBody}` : ''}）。请稍后再试，或在「⚙ 设置」中更换 API Key / 模型套餐。`;
  }
  return `运行过程中出现了问题：${truncate(text, 200)}`;
}

/** 实时进度更新：推理片段 / 工具调用 / 工具执行结果（开发进度报告与"开发团队怎么说"） */
export interface DSHProgressUpdate {
  kind: 'reasoning' | 'tool' | 'tool-result';
  /** reasoning：文本片段；tool：{name, arguments} 的 JSON 字符串；tool-result：结果文本 */
  text: string;
}

/** 从输出片段中提取实时进度更新。
 *  1) 先扫 headless runner 补丁写的 `<<<FC_*>>>` marker（保持兼容）
 *  2) 再兜底扫每行独立 JSON：识别模型工具调用结构（即便 dsh 上游没打补丁也能用）
 *     - 严格模式：必须含 name 字符串字段 + 已知工具名 + arguments 字段，或
 *       命中 Anthropic `type:'tool_use'` / OpenAI `function.name` 这两种通用形态
 *     - 跳过以 `<<<FC_` 开头的行（避免与上面 prefix 扫描重复）
 *     - 跳过不以 `{`/`[` 开头 或不以 `}`/`]` 结尾的行（避免误识别嵌入文本）
 */
export function extractProgressUpdates(chunk: string): DSHProgressUpdate[] {
  const updates: DSHProgressUpdate[] = [];
  const markers: { prefix: string; kind: DSHProgressUpdate['kind'] }[] = [
    { prefix: REASONING_STREAM, kind: 'reasoning' },
    { prefix: TOOL_CALL, kind: 'tool' },
    { prefix: TOOL_RESULT, kind: 'tool-result' },
  ];
  for (const { prefix, kind } of markers) {
    let idx = 0;
    while (idx < chunk.length) {
      const start = chunk.indexOf(prefix, idx);
      if (start < 0) break;
      const lineEnd = chunk.indexOf('\n', start);
      const payload =
        lineEnd < 0
          ? chunk.slice(start + prefix.length)
          : chunk.slice(start + prefix.length, lineEnd);
      try {
        const parsed = JSON.parse(payload) as unknown;
        if (typeof parsed === 'string' && parsed) updates.push({ kind, text: parsed });
        else if (parsed && typeof parsed === 'object') {
          updates.push({ kind, text: JSON.stringify(parsed) });
        }
      } catch {
        /* 片段被截断或非 JSON：忽略，等待下一条 */
      }
      idx = lineEnd < 0 ? chunk.length : lineEnd + 1;
    }
  }
  // 兜底：单行 JSON 工具调用识别（适配 dsh 上游未打补丁的场景）
  updates.push(...extractJsonLineToolCalls(chunk));
  return updates;
}

/** 已知工具调用名集合（大小写不敏感，子串匹配）。
 *  toolProgressLabel(dev/developer.ts) 也是按这些子串分类显示 📝/🛠/🧪 等图标，
 *  这里保持一致的判定，避免识别为 tool 后却无法渲染为开发进度报告。
 *  保守起见只识别文件/命令/测试类工具——通用聊天场景里这些词出现概率低，误识别风险小。
 */
const KNOWN_TOOL_NAME_TOKENS = [
  'write', 'create_file', 'edit', 'replace', 'patch', 'delete',
  'read', 'view', 'ls', 'glob', 'grep', 'search',
  'bash', 'shell', 'exec', 'run_command',
  'npm_test', 'pytest', 'jest',
  'mkdir', 'touch',
];

/** 单行 JSON 兜底识别：扫描每行独立 JSON；命中工具调用结构则推送 tool update。
 *  仅识别 `tool` 类型——`tool-result` 的结构太发散（模型可能输出各种成功/失败消息），
 *  误识别代价大于收益，留给 FC_* marker 路径。
 */
export function extractJsonLineToolCalls(chunk: string): DSHProgressUpdate[] {
  const updates: DSHProgressUpdate[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('<<<FC_')) continue; // 已被 prefix 扫描处理
    // 预检：必须以 { 或 [ 开头、以 } 或 ] 结尾（独立完整 JSON 行）
    if (!/^[{[]/.test(trimmed)) continue;
    if (!/[\]}]\s*$/.test(trimmed)) continue;
    // 预检：必须含 "name" 字段（避免每行 JSON.parse 浪费 CPU）
    if (!(/["']name["']/.test(trimmed))) continue;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const candidate = normalizeToolCall(parsed);
      if (candidate) {
        updates.push({ kind: 'tool', text: JSON.stringify(candidate) });
      }
    } catch {
      /* 非 JSON 或结构不对：忽略 */
    }
  }
  return updates;
}

/** 把解析后的 JSON 归一化为 `{name, arguments}` 形态（dev/developer.ts toolProgressLabel 期望的结构）。
 *  命中以下三种协议之一才返回：
 *  A. FreeCoder / 通用：{ name: 'write_file', arguments: '...' | {...} }
 *  B. Anthropic tool_use：{ type: 'tool_use', name: '...', input: {...} }
 *  C. OpenAI function call：{ function: { name: '...', arguments: '...' | {...} } }
 *  工具名必须是已知集合（KNOWN_TOOL_NAME_TOKENS）以避免误识别模型回复里的纯数据 JSON。
 */
function normalizeToolCall(parsed: unknown): { name: string; arguments: string } | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  // 形态 A：FreeCoder / 通用协议
  if (typeof obj.name === 'string' && obj.arguments !== undefined) {
    const name = obj.name.toLowerCase();
    if (isKnownToolName(name)) {
      return {
        name: obj.name,
        arguments: typeof obj.arguments === 'string' ? obj.arguments : JSON.stringify(obj.arguments),
      };
    }
  }

  // 形态 B：Anthropic tool_use
  if (obj.type === 'tool_use' && typeof obj.name === 'string') {
    const name = obj.name.toLowerCase();
    if (isKnownToolName(name)) {
      return {
        name: obj.name,
        arguments: typeof obj.input === 'string' ? obj.input : JSON.stringify(obj.input ?? {}),
      };
    }
  }

  // 形态 C：OpenAI function call（嵌套在 function 字段下）
  if (obj.function && typeof obj.function === 'object') {
    const fn = obj.function as Record<string, unknown>;
    if (typeof fn.name === 'string' && fn.arguments !== undefined) {
      const name = fn.name.toLowerCase();
      if (isKnownToolName(name)) {
        return {
          name: fn.name,
          arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments),
        };
      }
    }
  }

  return null;
}

/** 子串匹配（大小写不敏感）：与 dev/developer.ts toolProgressLabel 保持一致判定 */
function isKnownToolName(name: string): boolean {
  for (const token of KNOWN_TOOL_NAME_TOKENS) {
    if (name.includes(token)) return true;
  }
  return false;
}

/**
 * 解析 headless stdout：拆出推理过程与最终回复。
 * 带补丁的 runner 输出 `<推理流行*><<<FC_REASONING_START>>>\n<推理>\n<<<FC_REASONING_END>>>\n<完整回复>`
 * - 推理 = 信封内文本
 * - 回复 = 剔除信封与推理流标记行后的完整文本（**保留多行**，不能用 extractLastReply 只取最后一行）
 *
 * 无信封时（旧版 dsh / 直答型任务 / 噪音行场景）：保留完整多行 stdout，
 * 仅剔除 FC_* marker 行（避免噪音进入聊天历史），让引导式对话、需求卡片 JSON
 * 等多行结构都能完整呈现——v0.1.09 修复：之前 fallback 走 extractLastReply 只取最后
 * 一行，导致「请选择：+ A/B/C/D/E」这类引导对话被截断为「E. 其他（告诉我具体是啥）」。
 */
export function parseDshOutput(stdout: string): { reply: string; reasoning?: string } {
  const startIdx = stdout.indexOf(REASONING_START);
  const endIdx = stdout.indexOf(REASONING_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const reasoning = stdout.slice(startIdx + REASONING_START.length, endIdx).trim();
    // 整体切除信封区段（START 标记 → END 标记，含推理文本），再剔除推理流标记行，
    // 剩余部分即完整回复（可能多行）
    const clean = (stdout.slice(0, startIdx) + stdout.slice(endIdx + REASONING_END.length))
      .split(/\r?\n/)
      .filter((line) => !line.includes(REASONING_STREAM))
      .join('\n')
      .trim();
    return { reply: clean || stripMarkerLines(stdout), reasoning: reasoning || undefined };
  }
  // 无信封：保留完整多行（剔除 FC_* marker 噪音行），避免引导式对话被截断成单行
  return { reply: stripMarkerLines(stdout) };
}

/**
 * DSH 任务执行超时。deepseek-v4-flash 为推理模型，复杂代理任务（多次工具调用）
 * 实测可达 10~20 分钟（见 ~/.dsh/storages 会话统计），5 分钟会误杀长任务，给足 30 分钟。
 */
const DSH_TASK_TIMEOUT_MS = 30 * 60 * 1000;

function waitForExit(manager: DSHProcessManager, timeoutMs = DSH_TASK_TIMEOUT_MS): Promise<DSHExitInfo> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.stop().catch(() => undefined);
      reject(new Error('DSH 任务执行超时'));
    }, timeoutMs);
    manager.once('exit', (info) => {
      clearTimeout(timer);
      resolve(info);
    });
    // spawn 失败（如命令不存在）：manager 会先 emit 'error' 再 emit 'exit'，
    // 这里监听 'error' 立即失败，避免调用方长时间挂起
    manager.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** DSH 任务诊断日志（~/.freecoder/logs/dsh-task.log）：记录任务输出尾部与退出码，排查卡住/超时 */
function appendTaskLog(projectDir: string, task: string, output: string, exitCode: number | null): void {
  try {
    const logDir = path.join(os.homedir(), '.freecoder', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const tail = output.slice(-2000);
    fs.appendFileSync(
      path.join(logDir, 'dsh-task.log'),
      [
        `[${new Date().toISOString()}] cwd=${projectDir}`,
        `task=${task.slice(0, 200)}`,
        `exit=${exitCode ?? -1} outputChars=${output.length}`,
        `outputTail:\n${tail}`,
        '-'.repeat(60),
        '',
      ].join('\n'),
      'utf-8',
    );
  } catch {
    /* 日志失败不影响业务 */
  }
}

/** 将 DSHServiceOptions.command 归一化为启动描述 */
function toLaunch(command: string[] | DSHLaunch | undefined): DSHLaunchDescriptor {
  if (Array.isArray(command)) {
    return { argv: command, source: 'custom', description: '自定义命令' };
  }
  if (command && Array.isArray(command.argv) && command.argv.length > 0) {
    return {
      ...command,
      source: 'custom',
      description: '自定义命令',
    };
  }
  return resolveDshLaunch();
}

/** DSH 一次性任务服务：每个任务启动 headless 进程，返回最终回复
 *
 * 同时作为 dsh 实时状态的发布者（方案 3）：
 * - 继承 EventEmitter，emit 'state'，payload 为 DSHState
 * - 聚合多个 DSHProcessManager 的 status + 启动入口可用性
 * - 渲染层可订阅 dsh:state-change 拿到实时变化，或初次拉取快照 dsh:state
 *  - 状态栏按 DSHState 选用文案：idle(就绪·按需启动) / starting / running / stopping / error / missing
 */
export class DSHService extends EventEmitter {
  private readonly launch: DSHLaunchDescriptor;
  private readonly dshHome?: string;
  private readonly apiKeyProvider?: () => Promise<DSHCredentials | null>;
  /** 当前在跑的 DSH 子进程集合（每调用一次 runTask 注册一个，结束移出） */
  private readonly activeManagers = new Set<DSHProcessManager>();
  /** 最近一次计算的聚合状态快照；onStateChange 会把这份快照立刻推给订阅者 */
  private currentState: DSHState;

  constructor(options: DSHServiceOptions = {}) {
    super();
    this.launch = toLaunch(options.command);
    this.dshHome = options.dshHome;
    this.apiKeyProvider = options.apiKeyProvider;
    this.currentState = this.computeState();
  }

  getCommand(): string[] {
    return this.launch.argv;
  }

  getLaunch(): DSHLaunchDescriptor {
    return this.launch;
  }

  /**
   * 取一次 dsh 聚合状态的同步快照。渲染层初次挂载时拉一次拿到当前态，
   * 之后再通过 onStateChange 订阅增量变化。详见 DSHState。
   */
  getState(): DSHState {
    return this.currentState;
  }

  /**
   * 订阅 dsh 状态变化：handler 会立即收到一次当前快照，之后每次状态切换再推送。
   * 返回取消订阅函数。
   *
   * 典型用法（主进程 IPC 注册）：
   *   const off = dsh.onStateChange((s) => win.webContents.send('dsh:state-change', s));
   *   ipcMain.on('renderer-leave', off);
   */
  onStateChange(handler: (state: DSHState) => void): () => void {
    this.on('state', handler);
    handler(this.currentState);
    return () => {
      this.off('state', handler);
    };
  }

  /**
   * 计算当前 dsh 聚合状态。优先级：
   *  1. 启动入口缺失（launch.source='missing' 或关键文件不存在）→ status='missing'
   *  2. 有 manager 处于 error（出错后还没被清理）→ 'error'
   *  3. 有 manager stopping → 'stopping'
   *  4. 有 manager running → 'running'
   *  5. 有 manager starting → 'starting'
   *  6. 否则 idle（启动入口齐了 + 当前无任务 = 休眠中）
   */
  private computeState(): DSHState {
    const launchOk = this.launch.source !== 'missing' && this.launchAvailable();
    if (!launchOk) {
      return {
        available: false,
        status: 'missing',
        busyCount: 0,
        message: MISSING_LAUNCH_MESSAGE,
        reason: this.launch.description,
      };
    }
    if (this.activeManagers.size === 0) {
      return {
        available: true,
        status: 'idle',
        busyCount: 0,
        message: '休眠中',
      };
    }
    const flags = { error: 0, stopping: 0, running: 0, starting: 0 };
    for (const m of this.activeManagers) {
      const s: DSHStatus = m.getStatus();
      if (s === 'error') flags.error += 1;
      else if (s === 'stopping') flags.stopping += 1;
      else if (s === 'running') flags.running += 1;
      else if (s === 'starting') flags.starting += 1;
    }
    let status: DSHRunStatus;
    let message: string;
    if (flags.error > 0) {
      status = 'error';
      message = 'dsh 上一次任务异常';
    } else if (flags.stopping > 0) {
      status = 'stopping';
      message = 'dsh 停止中';
    } else if (flags.running > 0) {
      status = 'running';
      message =
        this.activeManagers.size === 1
          ? 'dsh 任务进行中'
          : `dsh 任务进行中（${this.activeManagers.size} 个并行）`;
    } else if (flags.starting > 0) {
      status = 'starting';
      message = 'dsh 启动中…';
    } else {
      // 全是 stopped/idle 之类的终态：等 finally 真正移除后回到 idle，这里给一个过渡文案
      status = 'idle';
      message = '休眠中';
    }
    return {
      available: true,
      status,
      busyCount: this.activeManagers.size,
      message,
    };
  }

  /** 重算并比较：变化则更新 currentState 并 emit('state') 通知订阅者 */
  private notifyStateChanged(): void {
    const next = this.computeState();
    const prev = this.currentState;
    if (
      prev.available === next.available &&
      prev.status === next.status &&
      prev.busyCount === next.busyCount &&
      prev.message === next.message &&
      prev.reason === next.reason
    ) {
      return;
    }
    this.currentState = next;
    this.emit('state', next);
  }

  /** dsh 运行时是否可用（打包前/开发环境据此展示提示） */
  private launchAvailable(): boolean {
    const l = this.launch;
    if (l.source === 'bundled') {
      return !!l.argv[0] && !!l.argv[1] && fs.existsSync(l.argv[0]) && fs.existsSync(l.argv[1]);
    }
    if (l.source === 'path') return !!l.argv[0] && fs.existsSync(l.argv[0]);
    return true; // env / custom 由用户显式指定，视为可用
  }

  /** 健康检查：dsh 运行时是否就绪（用于 app:info 状态提示） */
  checkHealth(): { available: boolean; message: string } {
    const l = this.launch;
    switch (l.source) {
      case 'env':
      case 'custom':
        return { available: true, message: l.description };
      case 'bundled': {
        const ok =
          !!l.argv[0] && !!l.argv[1] && fs.existsSync(l.argv[0]) && fs.existsSync(l.argv[1]);
        return {
          available: ok,
          message: ok ? '已内置 DeepSeek Harness（dsh）运行时' : '内置 dsh 运行时文件缺失',
        };
      }
      case 'path': {
        const ok = !!l.argv[0] && fs.existsSync(l.argv[0]);
        return {
          available: ok,
          message: ok ? `PATH 中的 dsh（${l.argv[0]}）` : 'PATH 中的 dsh 已不可用',
        };
      }
      default:
        return {
          available: false,
          message: MISSING_LAUNCH_MESSAGE,
        };
    }
  }

  /** 按提供商构造子进程环境变量（对应 DSH provider 的 apiKeyEnv 字段） */
  private buildEnv(creds: DSHCredentials | null): NodeJS.ProcessEnv | undefined {
    if (!creds) return undefined;
    if (creds.provider === 'openai-compatible') {
      const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: creds.apiKey };
      if (creds.baseUrl) env.OPENAI_BASE_URL = creds.baseUrl;
      if (creds.model) env.OPENAI_MODEL = creds.model;
      return env;
    }
    return { DEEPSEEK_API_KEY: creds.apiKey };
  }

  /**
   * 运行一次性 headless 任务（projectDir 作为 DSH workspace）。
   * @param onProgress 实时进度更新（推理片段 reasoning / 工具调用 tool，开发进度报告）
   * @param signal 取消信号：abort 时杀掉子进程并抛 TASK_CANCELLED（用于用户插话调整/停止）
   */
  async runTask(
    projectDir: string,
    task: string,
    onProgress?: (update: DSHProgressUpdate) => void,
    signal?: AbortSignal,
  ): Promise<DSHResult> {
    // 1. API Key 检查：未接入大模型 API 时无法工作，抛业务错误（渲染层据此弹窗引导接入）
    const creds = this.apiKeyProvider ? await this.apiKeyProvider() : null;
    if (!creds?.apiKey) {
      throw new DSHError(
        'API_KEY_MISSING',
        '尚未配置大模型 API Key。请点击右上角「配置 API Key」完成接入后，再开始对话。',
      );
    }

    // 2. dsh 运行时检查：避免 spawn ENOENT 这类硬错误
    if (this.launch.source === 'missing' || !this.launchAvailable()) {
      throw new DSHError(
        'DSH_START_FAILED',
        `无法启动 DeepSeek Harness（dsh）：${this.launch.description}。请安装 dsh 或设置 FREECODER_DSH_COMMAND 环境变量后重试。`,
      );
    }

    // 3. 注入本地加密存储的 API Key（按 provider 选择 env 变量名）
    const manager = new DSHProcessManager({
      command: [...this.launch.argv, '--profile', 'headless', task],
      dshHome: this.launch.dshHome ?? this.dshHome,
      cwd: projectDir,
      autoRestart: false,
      env: { ...this.launch.env, ...this.buildEnv(creds) },
    });

    let output = '';
    manager.on('output', (o) => {
      // 只累积 stdout；stderr 仅用于实时转发给 UI（如 dev 调试信息），
      // 不能混入 reply 字符串（否则会泄漏到聊天历史 / 触发 parseDshOutput 噪音）。
      // v0.1.09 之前这里无条件 `output += o.data`，把 stderr 也吃进 reply——典型症状：
      // fake-dsh 的 `[FakeDSH] profile=...` 调试回显（输出到 stderr）会被当作 AI 回复首行展示。
      if (o.stream === 'stdout') {
        output += o.data;
      }
      // 实时进度更新：推理增量 + 工具调用（开发进度报告）逐条转发给调用方
      if (onProgress) {
        for (const update of extractProgressUpdates(o.data)) onProgress(update);
      }
    });

    // 取消支持：abort 时杀掉子进程；runTask 会以 TASK_CANCELLED 结束
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      manager.stop().catch(() => undefined);
    };
    if (signal) {
      if (signal.aborted) {
        // 尚未启动即被取消：直接结束，不 spawn 子进程
        throw new DSHError('TASK_CANCELLED', '任务已被中断');
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // 注册 manager 到活跃集合 + 监听 status 变化 → 实时同步到聚合状态。
    // ⚠️ 注意顺序：必须先 add + on，再 start() —— manager.start() 内部是同步 spawn，
    // 会立刻 setStatus('starting') → setStatus('running')，若监听器还没挂上就收不到这两帧，
    // 徽章的 'starting' 分支将永远见不到。
    // 终态处理：manager 进入 stopped / idle 等终态后立刻 off + delete，避免 computeState()
    // 拿到一个「status=stopped 但 activeManagers 还在」的不一致快照（flags 全空，busyCount=1，
    // 推流 {status:'idle', busyCount:1} 是语义脏数据）。finally 保留作为正常路径清理，
    // 极端重复清理走 Set.delete() 幂等，off() 也幂等。
    this.activeManagers.add(manager);
    const onManagerStatusChange = (s: DSHStatus) => {
      if (s === 'stopped' || s === 'idle') {
        manager.off('status', onManagerStatusChange);
        this.activeManagers.delete(manager);
      }
      this.notifyStateChanged();
    };
    manager.on('status', onManagerStatusChange);

    // 【关键】启动子进程。此前缺失 start() 导致进程从未 spawn、任务永远卡在等待退出。
    manager.start();
    this.notifyStateChanged();

    let exit: DSHExitInfo;
    try {
      exit = await waitForExit(manager);
    } catch (error) {
      // 错误已经向上抛；finally 负责 manager 清理。
      if (cancelled || signal?.aborted) {
        throw new DSHError('TASK_CANCELLED', '任务已被中断');
      }
      // 诊断：记录失败任务的输出（脱敏后由 appendTaskLog 落盘）
      try {
        const safeOut = creds ? output.split(creds.apiKey).join('[API_KEY_REDACTED]') : output;
        appendTaskLog(projectDir, task, sanitizeLog(safeOut), null);
      } catch {
        /* 日志失败不影响业务 */
      }
      if (error instanceof DSHError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      if (reason.includes('超时')) {
        throw new DSHError('DSH_TIMEOUT', `DSH 任务执行超时：${reason}`);
      }
      if (/ENOENT|spawn/i.test(reason)) {
        throw new DSHError('DSH_START_FAILED', `无法启动 DeepSeek Harness（dsh）运行时：${reason}`);
      }
      throw new DSHError('DSH_START_FAILED', `DSH 任务执行失败：${reason}`);
    } finally {
      // 终止态已发生（exit 已 emit）：从活跃集合移除并再推一次聚合状态，
      // 让 UI 立即从 running/starting 切回 idle。等待 notifyStateChanged 内部去重。
      manager.off('status', onManagerStatusChange);
      this.activeManagers.delete(manager);
      this.notifyStateChanged();
    }
    if (cancelled || signal?.aborted) {
      throw new DSHError('TASK_CANCELLED', '任务已被中断');
    }

    // 诊断：记录成功任务的输出尾部（脱敏后落盘，便于排查“卡住”类问题）
    try {
      const safeOut = creds ? output.split(creds.apiKey).join('[API_KEY_REDACTED]') : output;
      appendTaskLog(projectDir, task, sanitizeLog(safeOut), exit.code ?? -1);
    } catch {
      /* 日志失败不影响业务 */
    }

    // 防御：若子进程输出回显了 key（如错误信息），脱敏后再返回，避免明文进入 UI 与聊天记录
    const parsed = parseDshOutput(output);
    // 噪音过滤：DSH 偶发把大模型 API 错误（rate_limit / 认证失败 / 服务繁忙等）透传到 stdout，
    // 这些信息不该当作“AI 回复”显示给用户。识别后拋出友好错误，走 IPC 错误路径
    // （系统消息）展示，避免污染聊天历史。
    const apiErr = detectApiError(parsed.reply);
    if (apiErr) {
      throw new DSHError(apiErr.code, apiErr.message);
    }
    const redact = (s: string) => (creds ? s.split(creds.apiKey).join('[API_KEY_REDACTED]') : s);
    const reply = sanitizeLog(redact(parsed.reply));
    const reasoning = parsed.reasoning ? sanitizeLog(redact(parsed.reasoning)) : undefined;
    return { reply, reasoning, exitCode: exit.code ?? -1 };
  }
}
