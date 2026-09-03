import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
import { DSHError } from '../dsh/errors';
import { buildDevelopmentTask } from '../dsh/prompt';
import { injectAuthRuntime } from './runtime';

export interface DeveloperDeps {
  storage: StorageManager;
  dsh: Pick<DSHService, 'runTask'>;
}

export interface DevelopmentOutcome {
  projectId: string;
  success: boolean;
  message: string;
  durationMs: number;
  /**
   * v3.2.2 P0-5-1：标记「被主动取消」（切项目 / 用户手动中断）。
   * IPC 层据此不广播 error/info 系统消息——避免给用户弹"任务已被中断"的红色提示。
   * 与 success=false（真正的失败）语义分离。
   */
  cancelled?: boolean;
}

/** 工具调用原始信息（name + arguments JSON 字符串） → 可读的开发进度文案 */
export function toolProgressLabel(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { name?: string; arguments?: string };
    const name = parsed.name ?? '';
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(parsed.arguments ?? '{}') as Record<string, unknown>;
    } catch {
      /* 参数非 JSON，忽略 */
    }
    const filePath =
      typeof args.path === 'string'
        ? args.path
        : typeof args.file === 'string'
          ? args.file
          : '';
    const command = typeof args.command === 'string' ? args.command : '';
    const n = name.toLowerCase();
    if (n.includes('write')) return `📝 写入 ${filePath || '文件'}`;
    if (n.includes('edit')) return `✏️ 修改 ${filePath || '文件'}`;
    if (n.includes('read')) return `📖 读取 ${filePath || '文件'}`;
    if (n.includes('bash') || n.includes('shell') || n.includes('exec')) {
      return `🛠 运行 ${command.slice(0, 60) || '命令'}`;
    }
    if (n.includes('test')) return `🧪 测试 ${filePath || command.slice(0, 40) || '功能'}`;
    return `🔧 ${name}${filePath ? ` ${filePath}` : command ? ` ${command.slice(0, 40)}` : ''}`;
  } catch {
    return '🔧 调用工具';
  }
}

/**
 * 开发执行器（WP-12）：版本计划确认后，调用 DSH 在项目代码目录生成应用。
 * 状态流转：planned → developing → ready（成功）或保持 developing（失败，可重试）。
 * 有版本计划时只开发 V1（MVP）功能子集，避免一次性堆砌全部功能。
 *
 * v3.2.2 P0-5：维护 `activeControllers` Map（projectId → AbortController），
 * 让调用方在用户切项目时可以主动中断旧的 DSH 进程，避免后台任务漂到新项目上。
 */
export class Developer {
  /** v3.2.2 P0-5：正在运行的开发任务 AbortController 集合（替代旧 Set），
   *  cancel(projectId) 时调用对应 controller.abort() 让 DSHProcessManager 自然退出。
   */
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(private readonly deps: DeveloperDeps) {}

  /** 该项目是否有开发任务正在运行 */
  isActive(projectId: string): boolean {
    return this.activeControllers.has(projectId);
  }

  /**
   * v3.2.2 P0-5：取消指定项目的开发任务。返回是否有任务被中断。
   * - 同一项目重复 cancel：幂等（第二次返回 false）。
   * - 切项目时由 IPC 层 project:cancel-development 调用，避免后台 DSH 漂到新项目。
   */
  cancel(projectId: string): boolean {
    const controller = this.activeControllers.get(projectId);
    if (!controller) return false;
    controller.abort('project-cancelled');
    return true;
  }

  /** 启动开发任务（后台执行，不阻塞调用方；完成后经 onDone 回调通知） */
  async startDevelopment(
    projectId: string,
    onDone: (outcome: DevelopmentOutcome) => void,
    onProgress?: (label: string) => void,
  ): Promise<void> {
    const storage = this.deps.storage;
    const started = Date.now();
    if (this.activeControllers.has(projectId)) return;
    // v3.2.2 P0-5：每次启动新建独立 controller，存到 Map 供 cancel 查询
    const controller = new AbortController();
    this.activeControllers.set(projectId, controller);

    const finish = (outcome: DevelopmentOutcome) => {
      // v3.2.2 P0-5：仅当 Map 里仍是当前 controller 才删除，避免 cancel 后被并发 finish 误删新任务
      if (this.activeControllers.get(projectId) === controller) {
        this.activeControllers.delete(projectId);
      }
      onDone(outcome);
    };

    try {
      await storage.updateProjectMeta(projectId, { status: 'developing' });

      const requirements = await storage.getRequirements(projectId);
      const meta = await storage.getProject(projectId);
      const task = buildDevelopmentTask(requirements, meta?.versionPlan ?? null);
      const codePath = storage.getProjectCodePath(projectId);

      const result = await this.deps.dsh.runTask(codePath, task, (update) => {
        // 工具调用 → 可读的开发进度报告（如「📝 写入 index.html」「🛠 运行 npm test」）
        // 工具执行结果 → "开发团队怎么说"（如「✓ 已完成页面布局」）
        if (!onProgress) return;
        if (update.kind === 'tool') onProgress(toolProgressLabel(update.text));
        else if (update.kind === 'tool-result') {
          const text = update.text.trim().replace(/\s+/g, ' ').slice(0, 100);
          if (text) onProgress(`✓ ${text}`);
        }
      }, controller.signal);
      // v3.2.2 P0-5：DSH 抛 TASK_CANCELLED 时不再当成失败结果推送，避免误导用户以为"开发遇到小状况"
      const durationMs = Date.now() - started;

      if (result.exitCode === 0) {
        // 仅登录模式才注入标准登录运行时（本地模式 authentication === 'none'
        // 的应用以 localStorage 持久化，不依赖 server.js / auth.js）。
        // 注入失败静默，不影响开发成功状态。
        if (requirements?.authentication !== 'none') {
          await injectAuthRuntime(codePath);
        }
        await storage.updateProjectMeta(projectId, { status: 'ready' });
        finish({
          projectId,
          success: true,
          message: '开发完成！您的应用已就绪，可以预览了',
          durationMs,
        });
      } else {
        finish({
          projectId,
          success: false,
          message: '开发遇到一点小状况，请稍后重试',
          durationMs,
        });
      }
    } catch (error) {
      // v3.2.2 P0-5-1：TASK_CANCELLED 是被主动中断的正常路径，不算失败也不该广播 error 给用户。
      // 与 chat:send IPC handler（chat.ts:112）的静默成功路径保持一致：
      //   - 标记 cancelled=true 让 IPC 层不调 onDone 广播
      //   - Map 清理走 finish() 的统一路径，避免漏 delete
      if (error instanceof DSHError && error.code === 'TASK_CANCELLED') {
        finish({
          projectId,
          success: false,
          message: '任务已取消',
          durationMs: Date.now() - started,
          cancelled: true,
        });
        return;
      }
      // API Key 缺失 / dsh 运行时缺失等：把友好信息透传给用户，避免静默卡在"开发中"
      const message =
        error instanceof Error && error.message ? error.message : '开发失败，请稍后重试';
      finish({ projectId, success: false, message, durationMs: Date.now() - started });
    }
  }
}
