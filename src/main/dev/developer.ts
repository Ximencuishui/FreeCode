import type { StorageManager } from '../storage/types';
import type { DSHService } from '../dsh/service';
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
 */
export class Developer {
  /** 正在运行的开发任务（项目 ID 集合），用于开发中断后的恢复判断 */
  private readonly active = new Set<string>();

  constructor(private readonly deps: DeveloperDeps) {}

  /** 该项目是否有开发任务正在运行 */
  isActive(projectId: string): boolean {
    return this.active.has(projectId);
  }

  /** 启动开发任务（后台执行，不阻塞调用方；完成后经 onDone 回调通知） */
  async startDevelopment(
    projectId: string,
    onDone: (outcome: DevelopmentOutcome) => void,
    onProgress?: (label: string) => void,
  ): Promise<void> {
    const storage = this.deps.storage;
    const started = Date.now();
    if (this.active.has(projectId)) return;
    this.active.add(projectId);

    const finish = (outcome: DevelopmentOutcome) => {
      this.active.delete(projectId);
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
      });
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
      // API Key 缺失 / dsh 运行时缺失等：把友好信息透传给用户，避免静默卡在"开发中"
      const message =
        error instanceof Error && error.message ? error.message : '开发失败，请稍后重试';
      finish({ projectId, success: false, message, durationMs: Date.now() - started });
    }
  }
}
