import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

/**
 * DSH 子进程管理器（架构文档 4.2.1）。
 * - 启动/停止 DSH 子进程，stdin/stdout/stderr 管道
 * - 状态机：idle → starting → running → stopping → stopped / error
 * - 崩溃自动重启（非预期退出且启用 autoRestart 时）
 */

export type DSHStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface DSHOutput {
  stream: 'stdout' | 'stderr';
  data: string;
}

export interface DSHProcessOptions {
  /** 启动命令（如 ['dsh'] 或 ['node', '<bin.js>']） */
  command: string[];
  /** DSH_HOME 环境变量覆盖 */
  dshHome?: string;
  /** 工作目录（默认：当前进程 cwd） */
  cwd?: string;
  /** 附加环境变量 */
  env?: NodeJS.ProcessEnv;
  /** 非预期退出时自动重启（崩溃恢复），默认 false */
  autoRestart?: boolean;
  /** 最大连续自动重启次数，默认 3 */
  maxRestarts?: number;
}

export interface DSHExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** 是否因崩溃触发自动重启 */
  restarted: boolean;
}

/** DSH 子进程管理器：事件输出 'output'、退出 'exit'、状态变更 'status' */
export class DSHProcessManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private status: DSHStatus = 'idle';
  private readonly autoRestart: boolean;
  private readonly maxRestarts: number;
  private restartCount = 0;
  private manualStop = false;
  private buffer = '';

  constructor(private readonly options: DSHProcessOptions) {
    super();
    this.autoRestart = options.autoRestart ?? false;
    this.maxRestarts = options.maxRestarts ?? 3;
  }

  getStatus(): DSHStatus {
    return this.status;
  }

  getPid(): number | null {
    return this.child?.pid ?? null;
  }

  getRestartCount(): number {
    return this.restartCount;
  }

  /** 启动 DSH 子进程（幂等：已在运行时直接返回） */
  start(): void {
    if (this.child || this.status === 'starting' || this.status === 'running') return;
    this.manualStop = false;
    this.spawnChild();
  }

  /** 向子进程 stdin 写一行（供支持 stdin 协议的模式使用；headless 一次性模式不需要） */
  writeLine(line: string): void {
    if (!this.child || !this.child.stdin.writable) return;
    this.child.stdin.write(`${line}\n`);
  }

  /** 优雅停止：发送终止信号并等待退出；5 秒未退出则强制结束（避免挂起） */
  stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.status = 'stopped';
      return Promise.resolve();
    }
    this.manualStop = true;
    this.setStatus('stopping');
    return new Promise((resolve) => {
      let settled = false;
      const killTimer = setTimeout(() => {
        // SIGTERM 未生效：升级为强制结束（Windows 无 SIGKILL，kill() 即终止）
        try {
          child.kill('SIGKILL');
        } catch {
          try {
            child.kill();
          } catch {
            /* 进程已退出 */
          }
        }
      }, 5000);
      const onExit = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        this.setStatus('stopped');
        resolve();
      };
      child.once('exit', onExit);
      // Windows 无 SIGTERM 语义，kill 即终止；尝试温和结束 stdin 后发送 SIGTERM
      try {
        child.stdin.end();
        child.kill('SIGTERM');
      } catch {
        try {
          child.kill();
        } catch {
          /* 进程已退出 */
        }
      }
    });
  }

  private spawnChild(): void {
    this.setStatus('starting');
    const [cmd, ...args] = this.options.command;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(this.options.dshHome ? { DSH_HOME: this.options.dshHome } : {}),
      ...this.options.env,
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(cmd, args, {
        cwd: this.options.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      this.setStatus('error');
      this.emit('error', error);
      return;
    }

    this.child = child;
    this.setStatus('running');

    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      this.emit('output', { stream: 'stdout', data: chunk.toString('utf-8') });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      this.emit('output', { stream: 'stderr', data: chunk.toString('utf-8') });
    });
    child.on('error', (error) => {
      // spawn 失败（如命令不存在）：不会触发 exit，需手动收尾避免调用方挂起
      this.child = null;
      this.setStatus('error');
      this.emit('error', error);
      this.emit('exit', { code: -1, signal: null, restarted: false });
    });
    child.on('exit', (code, signal) => {
      this.child = null;

      const shouldRestart =
        this.autoRestart && !this.manualStop && code !== 0 && this.restartCount < this.maxRestarts;

      if (shouldRestart) {
        this.restartCount += 1;
        this.spawnChild();
      } else {
        this.setStatus(code === 0 ? 'stopped' : 'error');
      }
      this.emit('exit', { code, signal, restarted: shouldRestart } satisfies DSHExitInfo);
    });
  }

  /** 读取当前累积的 stdout 文本（headless 模式下用于提取最终回复） */
  getStdout(): string {
    return this.buffer;
  }

  clearStdout(): void {
    this.buffer = '';
  }

  private setStatus(status: DSHStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status', status);
    }
  }
}
