import { BrowserWindow, dialog, shell, type OpenDialogOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IpcChannels } from '../../shared/types/ipc';
import type {
  ProjectListResult,
  ProjectCreateParams,
  ProjectCreateResult,
  ProjectDeleteParams,
  ProjectDeleteResult,
  ProjectGetParams,
  ProjectGetResult,
  ProjectConfirmParams,
  ProjectConfirmResult,
  ProjectConfirmPlanParams,
  ProjectConfirmPlanResult,
  ProjectSelectLocationResult,
  UpdateRequirementsParams,
  UpdateRequirementsResult,
  ProjectResumeDevelopmentParams,
  ProjectResumeDevelopmentResult,
  ProjectAutoTestParams,
  ProjectAutoTestResult,
  ProjectConvertToLocalModeParams,
  ProjectConvertToLocalModeResult,
  ProjectDocumentListParams,
  ProjectDocumentListResult,
  ProjectDocumentReadParams,
  ProjectDocumentReadResult,
  ProjectOpenAssetParams,
  ProjectOpenAssetResult,
  ProjectDocumentCategory,
  ProjectDocumentKind,
  ProjectDocumentSummary,
} from '../../shared/types/project';
import type { SignalEvent, ChatResponseEvent } from '../../shared/types/chat';
import type { StorageManager, Requirements } from '../storage/types';
import type { DSHService } from '../dsh/service';
import { buildRequirementReviewTask, buildAutoTestTask } from '../dsh/prompt';
import { parseStructuredTestReport } from '../dsh/testReportParser';
import { toolProgressLabel } from '../dev/developer';
import type { Developer } from '../dev/developer';
import type { VersionPlanner } from '../dev/planner';
import {
  backfillProjectDocs,
  writeLogoPlaceholder,
  writeReadmeDoc,
  writeRequirementsDoc,
  writeVersionPlanDoc,
} from '../dev/docsGenerator';
import { handleIpc, IpcError } from './helpers';

/**
 * 把文档生成这种"非关键路径写入"做成 fire-and-forget：
 * - 写入成功 / 跳过（null）记一行 info
 * - 写入失败仅 console.warn，不影响主流程
 * 这样 confirm / planner / confirmPlan / developer 这些 IPC handler 不会被文档
 * 写入阻塞，也避免单次写失败让上层 Promise 拒绝。
 *
 * 接受任意 thenable，泛型 T 在 await 后透传给 console.log；不限制必须是 string | null，
 * 兼容 backfillProjectDocs 这种返回多个字段的对象。
 */
function fireDocWrite<T>(label: string, promise: Promise<T>): void {
  void promise
    .then((target) => {
      if (target) {
        console.log(`[FreeCoder] ${label} →`, target);
      }
    })
    .catch((error) => {
      console.warn(`[FreeCoder] ${label} 失败：`, error);
    });
}

/** 向所有窗口推送 chat:signal 事件 */
function broadcastSignal(signal: SignalEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.chatSignal, signal);
  }
}

/** 向所有窗口推送 chat:response 事件（需求审查的进行态与结果） */
function broadcastResponse(projectId: string, event: ChatResponseEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.chatResponse, { ...event, projectId });
  }
}

const MAX_PROJECT_ITEMS = 240;
const MAX_SCAN_DEPTH = 4;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown']);
const IMAGE_MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.bmp', 'image/bmp'],
]);
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.cache',
  '.next',
  '.nuxt',
  '.pnpm-store',
  '.npm-cache',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
  'resources',
  'temp',
  'tmp',
]);
const CATEGORY_ORDER: Record<ProjectDocumentCategory, number> = {
  overview: 0,
  requirements: 1,
  plan: 2,
  technical: 3,
  testing: 4,
  contributing: 5,
  asset: 6,
  other: 7,
};

interface ScannedProjectEntry {
  absolutePath: string;
  relativePath: string;
  kind: ProjectDocumentKind;
}

function toForwardSlashPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function mediaTypeForExtension(extension: string): string | null {
  return IMAGE_MEDIA_TYPES.get(extension.toLowerCase()) ?? null;
}

function kindForExtension(extension: string): ProjectDocumentKind | null {
  if (DOCUMENT_EXTENSIONS.has(extension.toLowerCase())) return 'document';
  return mediaTypeForExtension(extension) ? 'image' : null;
}

function categoryForDocument(relativePath: string, kind: ProjectDocumentKind): ProjectDocumentCategory {
  if (kind === 'image') return 'asset';
  const fileName = path.basename(relativePath).toLowerCase();
  const normalized = relativePath.toLowerCase();
  if (fileName === 'readme.md' || fileName === 'readme.markdown') return 'overview';
  if (/(需求|requirement|prd)/.test(normalized)) return 'requirements';
  if (/(架构|技术|前端|接口|api|数据库|database|架构设计)/.test(normalized)) return 'technical';
  if (/(开发计划|版本|roadmap|changelog|release|plan)/.test(normalized)) return 'plan';
  if (/(测试|报告|test|spec)/.test(normalized)) return 'testing';
  if (fileName === 'contributing.md' || /贡献/.test(normalized)) return 'contributing';
  return 'other';
}

function createProjectDocumentSummary(
  entry: ScannedProjectEntry,
  stat: { size: number; mtime: Date },
): ProjectDocumentSummary {
  return {
    name: path.basename(entry.relativePath),
    relativePath: toForwardSlashPath(entry.relativePath),
    kind: entry.kind,
    category: categoryForDocument(entry.relativePath, entry.kind),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

async function scanProjectFiles(rootPath: string): Promise<ScannedProjectEntry[]> {
  const entries: ScannedProjectEntry[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || entries.length >= MAX_PROJECT_ITEMS) return;
    let dirEntries;
    try {
      dirEntries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    dirEntries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    for (const entry of dirEntries) {
      if (entries.length >= MAX_PROJECT_ITEMS) break;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) {
          await walk(absolutePath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = toForwardSlashPath(path.relative(rootPath, absolutePath));
      const isInDocs = depth === 0 || relativePath.startsWith('docs/');
      const kind = kindForExtension(path.extname(entry.name));
      if (!kind || (kind === 'document' && !isInDocs)) continue;
      entries.push({ absolutePath, relativePath, kind });
    }
  }

  await walk(rootPath, 0);
  return entries;
}

async function listProjectDocuments(codePath: string): Promise<ProjectDocumentSummary[]> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(codePath);
  } catch {
    return [];
  }

  const summaries: ProjectDocumentSummary[] = [];
  for (const entry of await scanProjectFiles(realRoot)) {
    try {
      const stat = await fs.stat(entry.absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      summaries.push(createProjectDocumentSummary(entry, stat));
    } catch {
      /* 扫描后文件被删除或变为不可读时忽略 */
    }
  }

  return summaries.sort(
    (a, b) =>
      CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
      a.relativePath.localeCompare(b.relativePath, 'zh-CN'),
  );
}

function validateDocumentRelativePath(relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    path.isAbsolute(relativePath) ||
    relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new IpcError('INVALID_PARAMS', '文档路径无效');
  }
  return relativePath;
}

async function readProjectFile(
  codePath: string,
  relativePath: string,
): Promise<{ summary: ProjectDocumentSummary; absolutePath: string; content: Buffer; mediaType: string | null }> {
  validateDocumentRelativePath(relativePath);
  let realRoot: string;
  try {
    realRoot = await fs.realpath(codePath);
  } catch {
    throw new IpcError('FILE_IO_ERROR', '项目目录尚不存在');
  }

  const absolutePath = path.resolve(realRoot, relativePath);
  let realFile: string;
  try {
    realFile = await fs.realpath(absolutePath);
  } catch {
    throw new IpcError('NOT_FOUND', '文档不存在或已被移动');
  }
  if (!isInside(realRoot, realFile)) {
    throw new IpcError('FILE_IO_ERROR', '文档位于项目目录之外');
  }

  const kind = kindForExtension(path.extname(relativePath));
  if (!kind) {
    throw new IpcError('INVALID_PARAMS', '只支持 Markdown 文档和常见图片素材');
  }
  if (kind === 'document' && !relativePath.startsWith('docs/') && relativePath.includes('/')) {
    throw new IpcError('FILE_IO_ERROR', 'Markdown 文档只能位于项目根目录或 docs 目录');
  }
  const stat = await fs.lstat(realFile);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new IpcError('FILE_IO_ERROR', '目标不是可读取的普通文件');
  }
  const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_MARKDOWN_BYTES;
  if (stat.size > maxBytes) {
    throw new IpcError(
      'FILE_IO_ERROR',
      `${kind === 'image' ? '图片素材' : 'Markdown 文档'}不能超过 ${maxBytes / 1024 / 1024} MB`,
    );
  }

  return {
    absolutePath: realFile,
    summary: createProjectDocumentSummary(
      { absolutePath: realFile, relativePath, kind },
      stat,
    ),
    content: await fs.readFile(realFile),
    mediaType: kind === 'image' ? mediaTypeForExtension(path.extname(relativePath)) : null,
  };
}

// 项目管理域 IPC（API 文档 4.3），基于本地存储实现
export function registerProjectIpc(
  storage: StorageManager,
  dsh: DSHService,
  developer: Developer,
  planner: VersionPlanner,
): void {
  handleIpc<undefined, ProjectListResult>(IpcChannels.projectList, async () => {
    const metas = await storage.listProjects();
    return {
      projects: metas.map((m) => ({
        id: m.id,
        name: m.name,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        lastOpenedAt: m.lastOpenedAt,
        status: m.status,
      })),
    };
  });

  handleIpc<ProjectCreateParams, ProjectCreateResult>(
    IpcChannels.projectCreate,
    async (_event, params) => {
      if (!params?.name?.trim()) {
        throw new IpcError('PROJECT_NAME_EMPTY', '项目名称不能为空');
      }
      const meta = await storage.createProject(params.name.trim(), {
        description: params.description,
        template: params.template,
        location: params.location,
      });
      // 记录为最近打开的项目（启动时恢复选中）
      await storage.saveSettings({ lastOpenedProject: meta.id });
      return {
        success: true,
        projectId: meta.id,
        projectPath: storage.getProjectDir(meta.id),
      };
    },
  );

  // 选择项目保存位置（系统文件夹选择器）。用户可取消，取消后由渲染层走"跳过"逻辑
  handleIpc<undefined, ProjectSelectLocationResult>(
    IpcChannels.projectSelectLocation,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options: OpenDialogOptions = {
        title: '选择项目保存位置',
        defaultPath: storage.getDefaultProjectsDir(),
        buttonLabel: '保存到此位置',
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, canceled: true };
      }
      return { success: true, canceled: false, path: result.filePaths[0] };
    },
  );

  handleIpc<ProjectDeleteParams, ProjectDeleteResult>(
    IpcChannels.projectDelete,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      if (params.confirm !== true) {
        throw new IpcError('INVALID_PARAMS', '删除项目需要二次确认');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      await storage.deleteProject(params.projectId);
      return { success: true };
    },
  );

  handleIpc<ProjectGetParams, ProjectGetResult>(IpcChannels.projectGet, async (_event, params) => {
    if (!params?.projectId?.trim()) {
      throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
    }
    const meta = await storage.getProject(params.projectId);
    if (!meta) {
      throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
    }
    // 记录最近打开时间（欢迎页"最近项目"排序依据；60 秒节流避免轮询频繁写盘）
    try {
      const lastOpened = new Date(meta.lastOpenedAt).getTime();
      if (Date.now() - lastOpened > 60_000) {
        await storage.updateProjectMeta(meta.id, { lastOpenedAt: new Date().toISOString() });
      }
    } catch {
      /* 记录失败不影响读取 */
    }
    const requirements = await storage.getRequirements(params.projectId);
    const history = await storage.getChatHistory(params.projectId, 50);
    return {
      success: true,
      project: {
        id: meta.id,
        name: meta.name,
        description: meta.description ?? '',
        requirements: {
          goal: requirements?.goal ?? '',
          targetUsers: requirements?.targetUsers ?? '',
          coreFeatures: requirements?.coreFeatures ?? [],
          visualStyle: requirements?.visualStyle ?? '',
          pages: requirements?.pages,
          layout: requirements?.layout,
          styleFeeling: requirements?.styleFeeling,
          device: requirements?.device,
          keyFlows: requirements?.keyFlows,
          authentication: requirements?.authentication,
          usageScale: requirements?.usageScale,
          exportFeatures: requirements?.exportFeatures,
          uiLanguage: requirements?.uiLanguage,
          platform: requirements?.platform,
        },
        versionPlan: meta.versionPlan ?? null,
        status: meta.status,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        chatHistory: history,
        codePath: storage.getProjectCodePath(meta.id),
      },
    };
  });

  /** 扫描当前项目可阅读的 Markdown 文档与图片素材 */
  handleIpc<ProjectDocumentListParams, ProjectDocumentListResult>(
    IpcChannels.projectListDocuments,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      // 老项目升级到本版本之前没有 docs/requirements.md / version-plan.md：
      // 第一次扫描时按需回填，让【文档】Tab 第一次进入就能看到需求与版本计划。
      // 改成 fire-and-forget：避免 4 次 stat + 多次 write 把 listDocuments IPC 阻塞 100-300ms；
      // backfill 内部对每个写入都已经 try/catch，此处 fireDocWrite 兜底防御性捕获。
      fireDocWrite('回填项目文档', backfillProjectDocs(storage, params.projectId));
      return {
        success: true,
        documents: await listProjectDocuments(storage.getProjectCodePath(project.id)),
      };
    },
  );

  /** 读取一个已扫描到的 Markdown 文档或图片素材，限制相对路径与文件大小 */
  handleIpc<ProjectDocumentReadParams, ProjectDocumentReadResult>(
    IpcChannels.projectReadDocument,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      const file = await readProjectFile(
        storage.getProjectCodePath(project.id),
        validateDocumentRelativePath(params.relativePath ?? ''),
      );
      if (file.summary.kind === 'image') {
        return {
          success: true,
          document: file.summary,
          absolutePath: file.absolutePath,
          asset: {
            src: `data:${file.mediaType};base64,${file.content.toString('base64')}`,
            mediaType: file.mediaType ?? 'application/octet-stream',
            alt: file.summary.name,
          },
        };
      }
      return {
        success: true,
        document: file.summary,
        absolutePath: file.absolutePath,
        content: file.content.toString('utf8'),
      };
    },
  );

  /**
   * 用系统默认应用打开项目内的一张图片素材（典型：.svg → 浏览器）。
   * 安全链路：项目存在 → 路径校验 → kind 必须是 image → realpath 仍在项目根 → 非符号链接。
   */
  handleIpc<ProjectOpenAssetParams, ProjectOpenAssetResult>(
    IpcChannels.projectOpenAsset,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      const file = await readProjectFile(
        storage.getProjectCodePath(project.id),
        validateDocumentRelativePath(params.relativePath ?? ''),
      );
      if (file.summary.kind !== 'image') {
        throw new IpcError('INVALID_PARAMS', '只能打开图片素材，Markdown 文档不支持外部打开');
      }
      // readProjectFile 已经过 realpath + isInside 校验；这里直接拼回项目根即可
      const absolutePath = path.join(
        storage.getProjectCodePath(project.id),
        file.summary.relativePath,
      );
      // shell.openPath 在 Windows/macOS/Linux 上都走系统默认应用；
      // 返回非空字符串表示错误描述（如"找不到应用"），空串代表成功
      const openError = await shell.openPath(absolutePath);
      if (openError) {
        return { success: false, error: openError };
      }
      return { success: true };
    },
  );

  // 手动编辑需求（确认前可修改需求项；合并进现有需求并记录历史）
  handleIpc<UpdateRequirementsParams, UpdateRequirementsResult>(
    IpcChannels.projectUpdateRequirements,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      const current = await storage.getRequirements(params.projectId);
      if (!current) {
        throw new IpcError('INVALID_PARAMS', '需求尚未生成，无法编辑');
      }
      const patch = params.requirements ?? {};
      const updated: Requirements = {
        ...current,
        goal: patch.goal ?? current.goal,
        targetUsers: patch.targetUsers ?? current.targetUsers,
        coreFeatures: patch.coreFeatures ?? current.coreFeatures,
        useScenarios: current.useScenarios,
        dataRequirements: current.dataRequirements,
        visualStyle: patch.visualStyle ?? current.visualStyle,
        platform: patch.platform ?? current.platform,
        pages: patch.pages ?? current.pages,
        layout: patch.layout ?? current.layout,
        styleFeeling: patch.styleFeeling ?? current.styleFeeling,
        device: patch.device ?? current.device,
        keyFlows: patch.keyFlows ?? current.keyFlows,
        authentication: patch.authentication ?? current.authentication,
        usageScale: patch.usageScale ?? current.usageScale,
        exportFeatures: patch.exportFeatures ?? current.exportFeatures,
        uiLanguage: patch.uiLanguage ?? current.uiLanguage,
        history: [
          ...current.history,
          {
            version: (current.history[current.history.length - 1]?.version ?? 0) + 1,
            timestamp: new Date().toISOString(),
            changes: '用户手动编辑需求',
          },
        ],
      };
      await storage.saveRequirements(params.projectId, updated);
      return { success: true };
    },
  );

  // 恢复/重启开发任务（用户从进度引导卡主动触发；已在运行则幂等返回）
  handleIpc<ProjectResumeDevelopmentParams, ProjectResumeDevelopmentResult>(
    IpcChannels.projectResumeDevelopment,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      if (developer.isActive(project.id)) {
        return { success: true, message: '开发任务正在运行中' };
      }
      void developer
        .startDevelopment(
          project.id,
          (outcome) => {
            // v3.2.2 P0-5-1：主动取消（切项目/用户中断）不广播给用户，避免红色 error 提示
            if (outcome.cancelled) return;
            broadcastSignal({
              type: outcome.success ? 'info' : 'error',
              message: outcome.message,
              timestamp: new Date().toISOString(),
            });
          },
          // 开发进度报告：实时推送工具调用（写文件/跑命令/测试等）
          (label) => {
            broadcastResponse(project.id, {
              type: 'progress',
              content: label,
              timestamp: new Date().toISOString(),
            });
          },
        )
        .catch(() => undefined);
      return { success: true, message: '已重新开始开发' };
    },
  );

  // 自动测试：编写测试用例、运行可行检查并审计代码，输出测试报告（就绪后可一键执行）
  handleIpc<ProjectAutoTestParams, ProjectAutoTestResult>(
    IpcChannels.projectAutoTest,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      const requirements = await storage.getRequirements(params.projectId);
      const task = buildAutoTestTask(requirements);
      broadcastResponse(params.projectId, {
        type: 'thinking',
        content: '🧪 正在自动测试与审计，请稍候…',
        source: 'auto-test',
        timestamp: new Date().toISOString(),
      });
      try {
        const result = await dsh.runTask(storage.getProjectCodePath(params.projectId), task, (update) => {
          // 测试过程实时进度（读文件/跑命令等）
          if (update.kind === 'tool') {
            broadcastResponse(params.projectId, {
              type: 'progress',
              content: `🧪 ${toolProgressLabel(update.text)}`,
              source: 'auto-test',
              timestamp: new Date().toISOString(),
            });
          }
        });
        const report = result.reply.trim();
        const structured = parseStructuredTestReport(report);
        if (report) {
          const saved = await storage.saveChatMessage(params.projectId, {
            role: 'assistant',
            // 聊天里展示人类可读报告（去掉 JSON 机器段后的剩余文本，避免重复）
            content: structured.fullReport || report,
            reasoning: result.reasoning,
            isComplete: true,
          });
          broadcastResponse(params.projectId, {
            type: 'message',
            content: structured.fullReport || report,
            reasoning: result.reasoning,
            messageId: saved.id,
            isComplete: true,
            requirements: null,
            source: 'auto-test',
            autoTestReport: structured,
            timestamp: new Date().toISOString(),
          });
        }
        return { success: true, report, structured };
      } catch (error) {
        console.warn('[FreeCoder] 自动测试失败：', error);
        return { success: false, message: '自动测试执行失败，请稍后重试' };
      }
    },
  );

  // 确认需求 → AI 先审查需求矛盾（可跳过）→ 进入版本分段阶段（planned），后台生成版本计划
  handleIpc<ProjectConfirmParams, ProjectConfirmResult>(
    IpcChannels.projectConfirm,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      const requirements = await storage.getRequirements(params.projectId);
      if (!requirements || (!requirements.goal && requirements.coreFeatures.length === 0)) {
        throw new IpcError('INVALID_PARAMS', '需求尚未生成，请先完成需求对话');
      }
      // 幂等保护：已进入版本分段（或后续阶段）时不重复生成计划
      if (project.status !== 'draft') {
        return { success: true };
      }

      // AI 需求审查：确认前过一遍，发现矛盾则回到对话继续澄清（用户可跳过）
      console.log('[confirm] 进入确认，开始审查', { projectId: params.projectId, skipReview: params.skipReview });
      if (!params.skipReview) {
        const history = await storage.getChatHistory(params.projectId, 30);
        const task = buildRequirementReviewTask(requirements, history);
        broadcastResponse(params.projectId, {
          type: 'thinking',
          content: '🔍 正在审查需求，检查是否有矛盾…',
          timestamp: new Date().toISOString(),
        });
        try {
          let liveReasoning = '';
          const review = await dsh.runTask(
            storage.getProjectCodePath(params.projectId),
            task,
            (fragment) => {
              liveReasoning += fragment;
              broadcastResponse(params.projectId, {
                type: 'thinking',
                content: liveReasoning,
                timestamp: new Date().toISOString(),
              });
            },
          );
          const reviewText = review.reply.trim();
          console.log('[confirm] 审查完成，reply 前 60 字：', JSON.stringify(reviewText.slice(0, 60)));
          if (reviewText && !reviewText.includes('REVIEW_PASS')) {
            // 发现问题：审查结果作为助理消息落库并推给前端，用户继续在对话中澄清
            const saved = await storage.saveChatMessage(params.projectId, {
              role: 'assistant',
              content: reviewText,
              reasoning: review.reasoning,
              isComplete: true,
            });
            broadcastResponse(params.projectId, {
              type: 'message',
              content: reviewText,
              reasoning: review.reasoning,
              messageId: saved.id,
              isComplete: true,
              requirements: null,
              timestamp: new Date().toISOString(),
            });
            return { success: false, needsReview: true };
          }
        } catch (error) {
          // 审查失败（如 API 不可用）不阻塞确认，直接进入规划
          console.warn('[confirm] 需求审查失败，跳过审查：', error);
        }
      }
      console.log('[confirm] 审查通过/跳过，进入规划');

      await storage.confirmRequirements(params.projectId);
      await storage.updateProjectMeta(params.projectId, { status: 'planned' });

      // 需求确认通过：立即把已确认需求落盘为 docs/requirements.md，
      // 让用户在【文档】工作区第一时间看到完整的需求说明书。
      // 同时刷新 README.md 的"文档导航"与"V1 核心功能"章节（虽然 plan 还没生成），
      // 让用户点开【文档】的 README 立刻能看到需求摘要 + 文档索引。
      // 失败仅告警，不影响状态推进（listDocuments 处的 backfill 也会兜底）。
      fireDocWrite('[confirm] 已写入需求文档', writeRequirementsDoc(storage, params.projectId));
      fireDocWrite('[confirm] 已写入 README', writeReadmeDoc(storage, params.projectId));

      // 后台生成版本分段计划，完成时推送信号（渲染端刷新计划卡片）
      void planner
        .generatePlan(params.projectId, (outcome) => {
          broadcastSignal({
            type: outcome.success ? 'info' : 'error',
            message: outcome.message,
            timestamp: new Date().toISOString(),
          });
          // 版本计划生成成功 → 落盘 docs/version-plan.md，让【文档】Tab 立即可见
          // 并刷新 README 的"V1 核心功能"索引
          if (outcome.success) {
            fireDocWrite(
              '[plan] 已写入版本计划文档',
              writeVersionPlanDoc(storage, params.projectId),
            );
            fireDocWrite('[plan] 已刷新 README', writeReadmeDoc(storage, params.projectId));
          }
        })
        .catch(() => undefined);

      return { success: true };
    },
  );

  // 确认版本分段计划（可携带用户调整后的计划）→ 启动开发
  handleIpc<ProjectConfirmPlanParams, ProjectConfirmPlanResult>(
    IpcChannels.projectConfirmPlan,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      const plan = params.plan ?? project.versionPlan;
      if (!plan || plan.versions.length === 0) {
        throw new IpcError('INVALID_PARAMS', '版本分段计划尚未生成，请稍候');
      }
      // 结构校验：V1 必须含版本标签与至少一个功能，避免非法计划导致静默回退为全量开发
      const v1 = plan.versions[0];
      if (
        !v1 ||
        typeof v1.label !== 'string' ||
        !v1.label.trim() ||
        !Array.isArray(v1.features) ||
        v1.features.length === 0
      ) {
        throw new IpcError('INVALID_PARAMS', '版本分段计划无效：请至少保留 1 个 V1 功能');
      }

      await storage.updateProjectMeta(params.projectId, {
        versionPlan: plan,
        status: 'developing',
      });

      // 用户可能调整了 V1/V2 功能划分 → 用最新 plan 重写 docs/version-plan.md，
      // 保证【文档】Tab 看到的版本计划与开发实际使用的 plan 完全一致。
      // 同时刷新 README，让"V1 核心功能"索引跟上。
      fireDocWrite(
        '[confirmPlan] 已写入版本计划文档',
        writeVersionPlanDoc(storage, params.projectId),
      );
      fireDocWrite('[confirmPlan] 已刷新 README', writeReadmeDoc(storage, params.projectId));

      // 后台执行开发（只开发 V1/MVP），完成时推送信号；开发中实时推送进度报告
      void developer
        .startDevelopment(
          params.projectId,
          (outcome) => {
            // v3.2.2 P0-5-1：主动取消（切项目/用户中断）不广播给用户，避免红色 error 提示
            if (outcome.cancelled) return;
            broadcastSignal({
              type: outcome.success ? 'info' : 'error',
              message: outcome.message,
              timestamp: new Date().toISOString(),
            });
            // 开发成功：DSH 通常会按需求生成自定义 logo/icon，但 prompt 没强制，
            // 兜底补一份 assets/logo.svg，让【文档】Tab 的图片素材区至少有图可看。
            // writeLogoPlaceholder 用 wx 原子创建，DSH 已生成则捕获 EEXIST 跳过，绝不覆盖。
            if (outcome.success) {
              fireDocWrite(
                '[develop] 已写入占位 logo',
                writeLogoPlaceholder(storage, params.projectId),
              );
            }
          },
          (label) => {
            broadcastResponse(params.projectId, {
              type: 'progress',
              content: label,
              timestamp: new Date().toISOString(),
            });
          },
        )
        .catch(() => undefined);

      return { success: true };
    },
  );

  // 转本地模式：把 authentication 改为 none 并把状态打回 planned，让用户重新走
  // 「确认 V1 计划 → 重新开发」以应用本地模式 prompt 生成纯前端应用。
  // 适用条件：项目已确认需求、authentication 不是 none、状态为 planned/developing/ready/exported。
  //
  // v0.1.02 P0-2：必须清空旧 versionPlan（旧 plan 基于 password authentication 生成，
  // 包含「账号系统/登录页/注册页」等不属于本地模式的 V1 功能），并主动触发 planner 重新生成。
  // 若保留旧 plan，用户点「确认 V1 计划，开始开发」时 Developer 会按旧 plan 写出仍含登录页的应用。
  // 同时不直接调 Developer.startDevelopment —— 让用户在对话页主动点「确认 V1 计划，开始开发」，
  // 避免静默重跑覆盖用户预期。
  handleIpc<ProjectConvertToLocalModeParams, ProjectConvertToLocalModeResult>(
    IpcChannels.projectConvertToLocalMode,
    async (_event, params) => {
      if (!params?.projectId?.trim()) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const project = await storage.getProject(params.projectId);
      if (!project) {
        throw new IpcError('PROJECT_NOT_FOUND', '项目不存在');
      }
      const current = await storage.getRequirements(params.projectId);
      if (!current) {
        throw new IpcError('INVALID_PARAMS', '需求尚未生成，无法转本地模式');
      }
      if (current.authentication === 'none') {
        return { success: false, error: '当前已是本地模式' };
      }

      // 1) 需求里 authentication 改为 none（记录历史以便追溯）
      const updated: Requirements = {
        ...current,
        authentication: 'none',
        history: [
          ...current.history,
          {
            version: (current.history[current.history.length - 1]?.version ?? 0) + 1,
            timestamp: new Date().toISOString(),
            changes: '用户手动切换为本地模式（authentication=none）',
          },
        ],
      };
      await storage.saveRequirements(params.projectId, updated);

      // 2) v0.1.02 P0-2：清空旧 versionPlan 并打回 planned。
      // 旧 plan 强依赖于 password authentication 的 V1 划分（含账号/登录页等模块），
      // 转本地模式后这些模块不再需要，必须重新生成。
      await storage.updateProjectMeta(params.projectId, {
        status: 'planned',
        versionPlan: null,
      });

      // 3) 重新回填 docs/requirements.md 并刷新 README 的"V1 核心功能"占位章节
      // （plan 还没生成时只刷新索引，V1 章节会留 "待生成" 提示）
      fireDocWrite('[convertToLocalMode] 已写入需求文档', writeRequirementsDoc(storage, params.projectId));
      fireDocWrite('[convertToLocalMode] 已刷新 README', writeReadmeDoc(storage, params.projectId));

      // 4) v0.1.02 P0-2：主动触发 planner 重新生成基于本地模式的版本计划。
      // 生成期间用户在对话页会看到"本地模式版本计划生成中"，完成后再点确认进入开发。
      void planner
        .generatePlan(params.projectId, (outcome) => {
          broadcastSignal({
            type: outcome.success ? 'info' : 'error',
            message: outcome.success
              ? '本地模式版本计划已重新生成，可在对话页确认 V1 计划'
              : `本地模式版本计划重新生成失败：${outcome.message}`,
            timestamp: new Date().toISOString(),
          });
          if (outcome.success) {
            fireDocWrite(
              '[convertToLocalMode] 已写入版本计划文档',
              writeVersionPlanDoc(storage, params.projectId),
            );
            fireDocWrite(
              '[convertToLocalMode] 已刷新 README',
              writeReadmeDoc(storage, params.projectId),
            );
          }
        })
        .catch((error) => {
          console.warn('[FreeCoder] 本地模式重新生成版本计划失败：', error);
          broadcastSignal({
            type: 'error',
            message: '本地模式版本计划重新生成失败，请点击「重新规划」',
            timestamp: new Date().toISOString(),
          });
        });

      // 5) 主动广播信号：通知渲染端「已转本地模式」以便切回对话页
      broadcastSignal({
        type: 'info',
        message: '已切换为本地模式，请等待版本计划重新生成后确认 V1 计划',
        timestamp: new Date().toISOString(),
      });

      return { success: true, message: '已切换为本地模式' };
    },
  );

  // v3.2.2 P0-5：取消指定项目的开发任务（切项目时由前端调用）
  // 通过 AbortController 触发 DSH runTask 抛 TASK_CANCELLED，从而优雅停止 Agent。
  handleIpc<{ projectId: string }, { success: boolean; cancelled: boolean }>(
    IpcChannels.projectCancelDevelopment,
    async (_event, params) => {
      const projectId = params?.projectId?.trim();
      if (!projectId) {
        throw new IpcError('INVALID_PARAMS', '项目 ID 不能为空');
      }
      const cancelled = developer.cancel(projectId);
      return { success: true, cancelled };
    },
  );
}
