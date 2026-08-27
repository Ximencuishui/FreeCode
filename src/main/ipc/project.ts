import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
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
} from '../../shared/types/project';
import type { SignalEvent, ChatResponseEvent } from '../../shared/types/chat';
import type { StorageManager, Requirements } from '../storage/types';
import type { DSHService } from '../dsh/service';
import { buildRequirementReviewTask, buildAutoTestTask } from '../dsh/prompt';
import { toolProgressLabel } from '../dev/developer';
import type { Developer } from '../dev/developer';
import type { VersionPlanner } from '../dev/planner';
import { handleIpc, IpcError } from './helpers';

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

/** 项目管理域 IPC（API 文档 4.3），基于本地存储实现 */
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
        if (report) {
          const saved = await storage.saveChatMessage(params.projectId, {
            role: 'assistant',
            content: report,
            reasoning: result.reasoning,
            isComplete: true,
          });
          broadcastResponse(params.projectId, {
            type: 'message',
            content: report,
            reasoning: result.reasoning,
            messageId: saved.id,
            isComplete: true,
            requirements: null,
            source: 'auto-test',
            timestamp: new Date().toISOString(),
          });
        }
        return { success: true, report };
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

      // 后台生成版本分段计划，完成时推送信号（渲染端刷新计划卡片）
      void planner
        .generatePlan(params.projectId, (outcome) => {
          broadcastSignal({
            type: outcome.success ? 'info' : 'error',
            message: outcome.message,
            timestamp: new Date().toISOString(),
          });
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

      // 后台执行开发（只开发 V1/MVP），完成时推送信号；开发中实时推送进度报告
      void developer
        .startDevelopment(
          params.projectId,
          (outcome) => {
            broadcastSignal({
              type: outcome.success ? 'info' : 'error',
              message: outcome.message,
              timestamp: new Date().toISOString(),
            });
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
  // 不直接调 Developer.startDevelopment —— 让用户在对话页主动点「确认 V1 计划，开始开发」，
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

      // 2) 状态打回 planned（保留 versionPlan 让重新开发复用；用户后续点「确认 V1 计划」重启开发）
      await storage.updateProjectMeta(params.projectId, { status: 'planned' });

      // 3) 主动广播信号：通知渲染端「已转本地模式」以便切回对话页
      broadcastSignal({
        type: 'info',
        message: '已切换为本地模式，请在对话页确认 V1 计划以重新生成应用',
        timestamp: new Date().toISOString(),
      });

      return { success: true, message: '已切换为本地模式' };
    },
  );
}
