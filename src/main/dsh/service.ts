import { DSHProcessManager, type DSHExitInfo } from './manager';
import { sanitizeLog } from '../security/encryption';
import type { LlmProviderKind } from '../../shared/types/settings';

/**
 * DSH 高层服务：面向 FreeCoder 业务的一次性任务执行。
 * 基于 `dsh --profile headless "task"` 模式（已验证：输出最终回复到 stdout 后退出）。
 * 多轮对话的会话保持策略在 WP-08 深入后于 WP-10 落地。
 */

export interface DSHServiceOptions {
  /** dsh 启动命令（默认 resolveDshCommand()） */
  command?: string[];
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
  /** 进程退出码（0=任务完成，1=未完成） */
  exitCode: number;
}

/**
 * 解析 dsh 启动命令，优先级：
 * 1. FREECODER_DSH_COMMAND 环境变量（支持 JSON 数组，如 ["node","C:/.../bin.js"]；也兼容空格分隔）
 * 2. 默认 PATH 中的 dsh（POSIX / 已配置 PATH 的环境）
 */
export function resolveDshCommand(): string[] {
  const envCmd = process.env.FREECODER_DSH_COMMAND;
  if (envCmd?.trim()) {
    try {
      const parsed = JSON.parse(envCmd);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed as string[];
      }
    } catch {
      /* 不是 JSON，退化到空格分隔 */
    }
    return envCmd.trim().split(/\s+/);
  }
  return ['dsh'];
}

/** 从 headless stdout 提取最终回复（最后一条非空文本行） */
export function extractLastReply(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

function waitForExit(manager: DSHProcessManager, timeoutMs = 300_000): Promise<DSHExitInfo> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.stop().catch(() => undefined);
      reject(new Error('DSH 任务执行超时'));
    }, timeoutMs);
    manager.once('exit', (info) => {
      clearTimeout(timer);
      resolve(info);
    });
  });
}

/** DSH 一次性任务服务：每个任务启动 headless 进程，返回最终回复 */
export class DSHService {
  private readonly command: string[];
  private readonly dshHome?: string;
  private readonly apiKeyProvider?: () => Promise<DSHCredentials | null>;

  constructor(options: DSHServiceOptions = {}) {
    this.command = options.command ?? resolveDshCommand();
    this.dshHome = options.dshHome;
    this.apiKeyProvider = options.apiKeyProvider;
  }

  getCommand(): string[] {
    return this.command;
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

  /** 运行一次性 headless 任务（projectDir 作为 DSH workspace） */
  async runTask(projectDir: string, task: string): Promise<DSHResult> {
    // 注入本地加密存储的 API Key（按 provider 选择 env 变量名）
    const creds = this.apiKeyProvider ? await this.apiKeyProvider() : null;
    const manager = new DSHProcessManager({
      command: [...this.command, '--profile', 'headless', task],
      dshHome: this.dshHome,
      cwd: projectDir,
      autoRestart: false,
      env: this.buildEnv(creds),
    });

    let output = '';
    manager.on('output', (o) => {
      output += o.data;
    });

    manager.start();
    const exit = await waitForExit(manager);
    // 防御：若子进程输出回显了 key（如错误信息），脱敏后再返回，避免明文进入 UI 与聊天记录
    const raw = extractLastReply(output);
    const reply = creds ? raw.split(creds.apiKey).join('[API_KEY_REDACTED]') : raw;
    return { reply: sanitizeLog(reply), exitCode: exit.code ?? -1 };
  }
}
