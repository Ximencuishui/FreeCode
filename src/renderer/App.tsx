import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import Sidebar from './components/Sidebar';
import ProjectSwitcher from './components/ProjectSwitcher';
import MiniChat from './components/Chat/MiniChat';
import AssistantPanel from './components/Preview/AssistantPanel';
import ChatContainer from './components/Chat/ChatContainer';
import ProjectWelcome from './components/ProjectWelcome';
import PreviewContainer from './components/Preview/PreviewContainer';
import RequirementCard from './components/Chat/RequirementCard';
import VersionPlanCard from './components/Chat/VersionPlanCard';
import ExportPanel from './components/Export/ExportPanel';
import ApiKeyModal from './components/ApiKeyModal';
import Logo from './components/Logo';
import StepFlow from './components/StepFlow';
import { useChatStore, type ResumeGuide, type ResumeAction } from './store/chat';
import { useProjectStore } from './store/project';
import { useUiStore } from './store/ui';
import { useExportStore, handleExportComplete } from './store/export';
import { useChatEvents } from './hooks/useChatEvents';
import type { AppInfo } from '@shared/types/app';
import type { AppSettings } from '@shared/types/settings';
import type { VersionPlan, RequirementSummary } from '@shared/types/project';

/** 主界面：三栏式布局（前端设计说明书 2.1） */
export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  /** 需求审查发现矛盾后为 true：卡片显示"跳过审查"逃生口 */
  const [reviewPending, setReviewPending] = useState(false);
  /** 右侧面板宽度（可拖动分隔条调整，默认 288px = w-72）；仅 chat 视图使用 */
  const [rightWidth, setRightWidth] = useState(288);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  /** 拖动分隔条：左右拖动调整预览区/右侧面板宽度（预览窗口可向左拖动放大） */
  const startResize = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: rightWidth };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // 向右拖 → 面板变窄、预览变宽；向左拖 → 面板变宽、预览变窄
      const next = d.startWidth + (d.startX - ev.clientX);
      setRightWidth(Math.min(520, Math.max(220, next)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projects = useProjectStore((s) => s.projects);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const currentView = useUiStore((s) => s.currentView);
  const setView = useUiStore((s) => s.setView);
  const requirements = useChatStore((s) => s.requirements);
  const projectStatus = useChatStore((s) => s.projectStatus);
  const versionPlan = useChatStore((s) => s.versionPlan);
  const selectedElement = useChatStore((s) => s.selectedElement);
  const elementInfo = useChatStore((s) => s.elementInfo);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setRequirements = useChatStore((s) => s.setRequirements);
  const setProjectStatus = useChatStore((s) => s.setProjectStatus);
  const setVersionPlan = useChatStore((s) => s.setVersionPlan);
  const setDevTaskRunning = useChatStore((s) => s.setDevTaskRunning);
  const devTaskRunning = useChatStore((s) => s.devTaskRunning);
  const autoTestRunning = useChatStore((s) => s.autoTestRunning);
  const autoTestLatestProgress = useChatStore((s) => s.autoTestLatestProgress);
  const devProgress = useChatStore((s) => s.devProgress);
  const lastTestSummary = useChatStore((s) => s.lastTestSummary);
  const apiKeyConfigured = useUiStore((s) => s.apiKeyConfigured);
  const setApiKeyConfigured = useUiStore((s) => s.setApiKeyConfigured);
  const openSettings = useUiStore((s) => s.openSettings);
  const openInvite = useUiStore((s) => s.openInvite);
  const openExport = useExportStore((s) => s.open);
  useChatEvents();

  // 订阅导出完成事件
  useEffect(() => {
    const unsub = window.electron.export.onComplete((data) => handleExportComplete(data));
    return unsub;
  }, []);

  // 项目切换时重置导出面板状态
  useEffect(() => {
    if (!currentProjectId) return;
    useExportStore.getState().reset();
  }, [currentProjectId]);

  useEffect(() => {
    void loadProjects();
    window.electron.app
      .getInfo()
      .then(setAppInfo)
      .catch(() => setAppInfo(null));
    window.electron.settings
      .get()
      .then(({ settings: s }) => {
        setSettings(s);
        setApiKeyConfigured(s.apiKeyConfigured);
        // 首次启动（未配置 API Key）：若用户尚未手动打开过设置弹窗，则自动弹出欢迎引导
        if (!s.apiKeyConfigured && !useUiStore.getState().settingsOpen) {
          openInvite();
        }
      })
      .catch(() => setSettings(null));
  }, [loadProjects, setApiKeyConfigured, openInvite]);

  // 保存成功（或外部变更）后刷新设置，保证下次打开弹窗回显最新配置
  const refreshSettings = useCallback(() => {
    window.electron.settings
      .get()
      .then(({ settings: s }) => {
        setSettings(s);
        setApiKeyConfigured(s.apiKeyConfigured);
      })
      .catch(() => undefined);
  }, [setApiKeyConfigured]);

  // 项目切换时加载项目上下文（需求 + 状态 + 版本计划 + 聊天历史）
  useEffect(() => {
    if (!currentProjectId) return;
    // 同步到对话 store（sendMessage 依赖），并加载已持久化的聊天历史（否则切视图/重启后对话消失）
    useChatStore.getState().setProject(currentProjectId);
    void useChatStore.getState().loadHistory(currentProjectId);
    window.electron.project
      .get({ projectId: currentProjectId })
      .then((result) => {
        if (result.success && result.project) {
          const r = result.project.requirements;
          setRequirements({
            goal: r.goal,
            targetUsers: r.targetUsers,
            coreFeatures: r.coreFeatures,
            visualStyle: r.visualStyle,
            pages: r.pages,
            layout: r.layout,
            styleFeeling: r.styleFeeling,
            device: r.device,
            keyFlows: r.keyFlows,
            authentication: r.authentication,
            usageScale: r.usageScale,
            exportFeatures: r.exportFeatures,
            uiLanguage: r.uiLanguage,
            platform: r.platform,
            confirmed:
              result.project.status !== 'draft' ||
              (r.goal.trim().length > 0 && r.coreFeatures.length > 0),
          });
          setProjectStatus(result.project.status);
          setVersionPlan(result.project.versionPlan ?? null);
        }
      })
      .catch(() => undefined);
  }, [currentProjectId, setRequirements, setProjectStatus, setVersionPlan]);

  // 版本分段阶段：计划由主进程后台异步生成，轮询直至拿到计划
  useEffect(() => {
    if (!currentProjectId || projectStatus !== 'planned' || versionPlan) return;
    const timer = setInterval(() => {
      window.electron.project
        .get({ projectId: currentProjectId })
        .then((result) => {
          if (result.success && result.project?.versionPlan) {
            setVersionPlan(result.project.versionPlan);
            clearInterval(timer);
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [currentProjectId, projectStatus, versionPlan, setVersionPlan]);

  // 开发阶段：后台开发完成后状态自动推进（ready），进度引导卡随之更新
  useEffect(() => {
    if (!currentProjectId || projectStatus !== 'developing') return;
    const timer = setInterval(() => {
      window.electron.project
        .get({ projectId: currentProjectId })
        .then((result) => {
          if (result.success && result.project && result.project.status !== 'developing') {
            setProjectStatus(result.project.status);
            setVersionPlan(result.project.versionPlan ?? null);
            setDevTaskRunning(false);
            clearInterval(timer);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [currentProjectId, projectStatus, setProjectStatus, setVersionPlan, setDevTaskRunning]);

  const handleConfirm = useCallback(
    async (skipReview = false) => {
      if (!currentProjectId) return;
      // 确认需求：主进程先 AI 审查矛盾（可跳过），通过后进入版本分段（planned），计划后台生成
      try {
        const result = await window.electron.project.confirm({
          projectId: currentProjectId,
          skipReview,
        });
        if (result.success) {
          setProjectStatus('planned');
          setReviewPending(false);
        } else if (result.needsReview) {
          // 审查发现问题：保持需求阶段，审查结果已作为消息推入对话，用户继续澄清
          setReviewPending(true);
        }
      } catch {
        setProjectStatus('draft');
      }
    },
    [currentProjectId],
  );

  const handleConfirmPlan = async (plan: VersionPlan) => {
    if (!currentProjectId) return;
    setProjectStatus('developing');
    setDevTaskRunning(true);
    try {
      const result = await window.electron.project.confirmPlan({
        projectId: currentProjectId,
        plan,
      });
      if (!result.success) {
        setProjectStatus('planned');
        setDevTaskRunning(false);
      }
    } catch {
      setProjectStatus('planned');
      setDevTaskRunning(false);
    }
  };

  /** 保存需求卡片的编辑结果（持久化 + 刷新渲染层状态） */
  const handleUpdateRequirements = useCallback(
    async (patch: Partial<RequirementSummary>): Promise<boolean> => {
      if (!currentProjectId) return false;
      const current = useChatStore.getState().requirements;
      if (!current) return false;
      try {
        const result = await window.electron.project.updateRequirements({
          projectId: currentProjectId,
          requirements: patch,
        });
        if (result.success) {
          setRequirements({ ...current, ...patch, confirmed: current.confirmed });
          return true;
        }
      } catch {
        /* 失败返回 false，由卡片提示 */
      }
      return false;
    },
    [currentProjectId, setRequirements],
  );

  /** 重新进入项目的进度引导：根据当前项目状态 + 视图实时推导（AI 助理汇报进度 + 继续下一步） */
  const resumeGuide = useMemo<ResumeGuide | null>(() => {
    if (!currentProjectId) return null;
    const project = projects.find((p) => p.id === currentProjectId);
    const name = project?.name ?? '当前项目';
    const hasReq = Boolean(
      requirements?.goal?.trim() || (requirements?.coreFeatures?.length ?? 0) > 0,
    );
    // 全新项目（未聊需求）：不需要恢复引导，交给空态提示
    if ((!projectStatus || projectStatus === 'draft') && !hasReq) return null;

    // 预览视图：引导聚焦"下一步该做什么"
    if (currentView === 'preview') {
      if (projectStatus === 'developing') {
        return devTaskRunning
          ? {
              projectId: currentProjectId,
              projectName: name,
              phaseText: 'AI 正在开发中，完成后会自动更新',
              action: 'none',
              actionText: '',
            }
          : {
              projectId: currentProjectId,
              projectName: name,
              phaseText: '开发进行到一半（可能被退出/重启打断）。要我继续把开发跑完吗？',
              action: 'refresh-status',
              actionText: '继续开发 →',
            };
      }
      if (projectStatus === 'ready' || projectStatus === 'exported') {
        return {
          projectId: currentProjectId,
          projectName: name,
          phaseText: '应用已就绪，正在预览。选择下面的方式开始测试吧：',
          action: 'none',
          actionText: '',
          actions: [
            { action: 'open-browser', label: '🌐 用浏览器打开看看效果' },
            { action: 'auto-test', label: '🧪 已经 ok，请帮我测试' },
          ],
        };
      }
      // planned / draft（需求已整理）：引导回对话页完成确认/开发
      return {
        projectId: currentProjectId,
        projectName: name,
        phaseText:
          projectStatus === 'planned'
            ? '版本分段计划已生成，先到对话页确认计划后开始开发'
            : '需求已整理完成，先到对话页确认需求（AI 会先审查一遍）',
        action: 'goto-chat',
        actionText: '去对话页继续',
      };
    }

    // 对话视图
    if (!projectStatus || projectStatus === 'draft') {
      return {
        projectId: currentProjectId,
        projectName: name,
        phaseText: '需求已整理完成，等待你确认。确认时 AI 会先帮您审查一遍，看有没有矛盾。',
        action: 'confirm-requirements',
        actionText: '确认需求，开始规划',
      };
    }
    if (projectStatus === 'planned') {
      if (versionPlan && versionPlan.versions.length > 0) {
        return {
          projectId: currentProjectId,
          projectName: name,
          phaseText: `版本分段计划已生成（V1 先做 ${versionPlan.versions[0].features.length} 个核心功能，跑通最小可用版本）`,
          action: 'confirm-plan',
          actionText: '确认 V1 计划，开始开发',
        };
      }
      return {
        projectId: currentProjectId,
        projectName: name,
        phaseText: '正在生成版本分段计划…请稍候',
        action: 'none',
        actionText: '',
      };
    }
    if (projectStatus === 'developing') {
      if (devTaskRunning) {
        return {
          projectId: currentProjectId,
          projectName: name,
          phaseText: 'AI 正在开发中，完成后会自动更新到这里',
          action: 'none',
          actionText: '',
        };
      }
      return {
        projectId: currentProjectId,
        projectName: name,
        phaseText: '开发进行到一半（可能被退出/重启打断）。要我继续把开发跑完吗？',
        action: 'refresh-status',
        actionText: '继续开发 →',
      };
    }
    if (projectStatus === 'ready') {
      return {
        projectId: currentProjectId,
        projectName: name,
        phaseText: '应用已就绪',
        action: 'goto-preview',
        actionText: '去预览看看效果',
      };
    }
    return {
      projectId: currentProjectId,
      projectName: name,
      phaseText: '部署包已导出',
      action: 'goto-preview',
      actionText: '去预览 / 继续调整',
    };
  }, [
    currentProjectId,
    projects,
    projectStatus,
    requirements,
    versionPlan,
    devTaskRunning,
    currentView,
  ]);

  /** 构建"浏览器测试引导"发言（模板 + 需求关键流程） */
  const buildTestGuide = useCallback(
    (url: string): string => {
      const flows = requirements?.keyFlows ?? [];
      const steps =
        flows.length > 0
          ? flows.map((f, i) => `${i + 1}. ${f}`).join('\n')
          : '1. 打开首页，检查页面是否正常显示\n2. 逐个点击核心功能，确认可交互\n3. 检查页面之间的跳转与数据保存';
      return `🌐 已为你打开浏览器（${url}），请按以下步骤测试：

${steps}

测试中发现任何问题，直接在这里告诉我，比如「登录组件没有加载」「点保存没反应」，我会立即帮你修改。`;
    },
    [requirements],
  );

  /** 进度引导卡的动作：继续下一步 */
  const handleResumeAction = (action: ResumeAction): void => {
    if (action === 'confirm-requirements') {
      void handleConfirm();
    } else if (action === 'confirm-plan') {
      const plan = useChatStore.getState().versionPlan;
      if (plan) void handleConfirmPlan(plan);
    } else if (action === 'goto-preview') {
      setView('preview');
    } else if (action === 'goto-chat') {
      setView('chat');
    } else if (action === 'open-browser') {
      // 用系统浏览器打开 + AI 发言引导测试步骤
      void window.electron.preview
        .openExternal()
        .then((result) => {
          if (result.success) {
            useChatStore
              .getState()
              .pushMessage({
                role: 'assistant',
                content: buildTestGuide(result.url ?? ''),
                timestamp: new Date().toISOString(),
              });
          }
        })
        .catch(() => undefined);
    } else if (action === 'auto-test') {
      // 一键自动测试：编写测试用例、运行检查、审计代码（报告作为消息推送）。
      // 点击后立即给用户可见反馈：设置 autoTestRunning=true → AssistantPanel 自动展开 📌 进度 Tab；
      // 起始消息通过 appendDevProgress 推送到开发日志（💬 Tab）。
      if (currentProjectId) {
        useChatStore.getState().setAutoTestRunning(true);
        useChatStore.getState().setAutoTestLatestProgress('🧪 已收到指令，正在准备测试环境…');
        useChatStore
        .getState()
        .appendDevProgress('🧪 已收到"一键测试"指令，开始编写测试用例并审计代码…');
        void window.electron.project
          .autoTest({ projectId: currentProjectId })
          .catch((err) => {
            // 主进程异常时也要复位"测试中"状态，避免右侧一直转圈
            useChatStore.getState().setAutoTestRunning(false);
            useChatStore.getState().setAutoTestLatestProgress(null);
            console.warn('[FreeCoder] 一键测试失败：', err);
          });
      }
    } else if (action === 'refresh-status' && currentProjectId) {
      // 继续开发：先触发恢复，成功后引导卡切换为"开发中"；再刷新最新状态
      void window.electron.project
        .resumeDevelopment({ projectId: currentProjectId })
        .then((result) => {
          if (result.success) setDevTaskRunning(true);
        })
        .catch(() => undefined);
      window.electron.project
        .get({ projectId: currentProjectId })
        .then((result) => {
          if (result.success && result.project) {
            setProjectStatus(result.project.status);
            setVersionPlan(result.project.versionPlan ?? null);
          }
        })
        .catch(() => undefined);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-white text-slate-800">
      {/* 标题栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-2">
          <Logo size={22} />
          <h1 className="text-base font-semibold">FreeCoder</h1>
          {appInfo && <span className="text-xs text-slate-400">v{appInfo.version}</span>}
          {/* 项目切换器（列表 + 新建入口） */}
          {projects.length > 0 && <ProjectSwitcher />}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (apiKeyConfigured !== true) openSettings();
            }}
            title={
              apiKeyConfigured === true
                ? '大模型 API 已配置'
                : apiKeyConfigured === false
                  ? '尚未配置大模型 API，点击配置'
                  : '加载中…'
            }
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
              apiKeyConfigured === true
                ? 'cursor-default bg-emerald-50 text-emerald-600'
                : apiKeyConfigured === false
                  ? 'cursor-pointer bg-amber-50 text-amber-600 hover:bg-amber-100'
                  : 'cursor-default bg-slate-50 text-slate-400'
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                apiKeyConfigured === true
                  ? 'bg-emerald-500'
                  : apiKeyConfigured === false
                    ? 'bg-amber-500'
                    : 'bg-slate-300'
              }`}
            />
            {apiKeyConfigured === true
              ? 'API 已配置'
              : apiKeyConfigured === false
                ? '配置 API Key'
                : '加载中…'}
          </button>
          <button
            type="button"
            onClick={openSettings}
            title="设置"
            aria-label="设置"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* 主流程步骤条（创建项目 → 方案探讨 → 生成代码 → 预览调整 → 导出） */}
      {currentProjectId && (
        <StepFlow
          status={projectStatus}
          onGoChat={() => setView('chat')}
          onGoPreview={() => setView('preview')}
          onGoExport={openExport}
        />
      )}

      {/* 主体：侧栏 + 工作区 + 右侧面板（chat 视图才有右侧面板，preview 视图交给 AI 助理浮窗） */}
      <main className="flex flex-1 overflow-hidden">
        <Sidebar />
        <section className="flex-1 overflow-hidden">
          {!currentProjectId ? (
            <ProjectWelcome />
          ) : currentView === 'chat' ? (
            <ChatContainer
              onConfirmRequirements={handleConfirm}
              resumeGuide={resumeGuide}
              onResumeAction={handleResumeAction}
              autoTestRunning={autoTestRunning}
              autoTestLatestProgress={autoTestLatestProgress}
            />
          ) : (
            <PreviewContainer />
          )}
        </section>
        {/* 右侧面板：chat 视图显示需求/版本计划 + MiniChat；preview 视图显示 AI 助理面板（共享一套可拖动分隔条） */}
        {currentProjectId && currentView === 'chat' && (
          <>
            {/* 可拖动分隔条：左右拖动调整工作区/右侧面板宽度 */}
            <div
              role="separator"
              aria-orientation="vertical"
              title="拖动调整右侧面板宽度"
              onMouseDown={startResize}
              className="group relative w-1.5 shrink-0 cursor-col-resize"
            >
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-200 transition-colors group-hover:bg-brand group-active:bg-brand" />
            </div>
            <aside className="flex shrink-0 flex-col bg-slate-50" style={{ width: rightWidth }}>
              {/* 可滚动内容区 */}
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {requirements ? (
                  <div className="space-y-4">
                    {(projectStatus === 'planned' || projectStatus === 'developing') && (
                      <VersionPlanCard
                        plan={versionPlan}
                        coreFeatures={requirements.coreFeatures}
                        status={projectStatus}
                        onConfirm={(plan) => void handleConfirmPlan(plan)}
                      />
                    )}
                    <RequirementCard
                      requirements={requirements}
                      status={projectStatus}
                      onConfirm={(skip) => void handleConfirm(skip)}
                      onUpdate={handleUpdateRequirements}
                      reviewPending={reviewPending}
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
                    📋 需求卡片
                    <br />
                    <span className="mt-1 block">完成需求对话后，这里会显示整理好的需求</span>
                  </div>
                )}
              </div>
              {/* 对话窗固定在底部：消息流在上、输入框贴底 */}
              <div className="shrink-0 border-t border-slate-200 bg-slate-100/70 p-3">
                <MiniChat placeholder="和 AI 聊聊，比如：不是说先不搞登录吗？" />
              </div>
            </aside>
          </>
        )}
        {/* preview 视图右侧面板：AI 助理（📌 进度 / 🔍 元素 / 💬 开发日志 + 底部 MiniChat） */}
        {currentProjectId && currentView === 'preview' && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              title="拖动调整右侧面板宽度"
              onMouseDown={startResize}
              className="group relative w-1.5 shrink-0 cursor-col-resize"
            >
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-200 transition-colors group-hover:bg-brand group-active:bg-brand" />
            </div>
            <AssistantPanel
              resumeGuide={resumeGuide}
              onResumeAction={handleResumeAction}
              autoTestRunning={autoTestRunning}
              autoTestLatestProgress={autoTestLatestProgress}
              selectedElement={selectedElement}
              elementInfo={elementInfo}
              isProcessing={isProcessing}
              onSendModify={(instruction) => void sendMessage(instruction)}
              devProgress={devProgress}
              lastTestSummary={lastTestSummary}
              onViewReport={() => setView('chat')}
              style={{ width: rightWidth }}
            />
          </>
        )}
      </main>

      {/* 状态栏 */}
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-slate-200 px-4 text-xs text-slate-400">
        <span>
          {apiKeyConfigured === true
            ? '● 大模型 API 已配置（本地加密存储）'
            : apiKeyConfigured === false
              ? '● 尚未配置大模型 API，点击右上角配置'
              : '● 正在加载设置…'}
          {appInfo?.dshAvailable === false && (
            <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-600">
              ⚠ {appInfo.dshHint ?? '未检测到 DSH 运行时'}
            </span>
          )}
        </span>
        <span>项目保存在本地 · 数据不上传</span>
      </footer>

      {/* 导出面板 */}
      <ExportPanel />

      {/* 首次启动 / 设置弹窗（欢迎态由 ui store 的 inviteMode 原子驱动） */}
      <ApiKeyModal
        onSaved={refreshSettings}
        initialProvider={settings?.provider}
        initialBaseUrl={settings?.baseUrl}
        initialModel={settings?.model}
        initialApiKeyMasked={settings?.apiKeyMasked}
      />
    </div>
  );
}
