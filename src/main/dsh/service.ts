import { DSHProcessManager, type DSHExitInfo } from './manager';

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
}

export interface DSHResult {
  /** headless 最终回复（stdout 最后一条非空文本） */
  reply: string;
  /** 进程退出码（0=任务完成，1=未完成） */
  exitCode: number;
}

/** 解析 dsh 启动命令：环境变量 FREECODER_DSH_COMMAND 优先（可指向打包后的运行时），默认 PATH 中的 dsh */
export function resolveDshCommand(): string[] {
  const envCmd = process.env.FREECODER_DSH_COMMAND;
  if (envCmd?.trim()) {
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

  constructor(options: DSHServiceOptions = {}) {
    this.command = options.command ?? resolveDshCommand();
    this.dshHome = options.dshHome;
  }

  getCommand(): string[] {
    return this.command;
  }

  /** 运行一次性 headless 任务（projectDir 作为 DSH workspace） */
  async runTask(projectDir: string, task: string): Promise<DSHResult> {
    const manager = new DSHProcessManager({
      command: [...this.command, '--profile', 'headless', task],
      dshHome: this.dshHome,
      cwd: projectDir,
      autoRestart: false,
    });

    let output = '';
    manager.on('output', (o) => {
      output += o.data;
    });

    manager.start();
    const exit = await waitForExit(manager);
    return { reply: extractLastReply(output), exitCode: exit.code ?? -1 };
  }
}
