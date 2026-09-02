import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import ProjectSwitcher from './components/ProjectSwitcher';
import DraggableChat from './components/Chat/DraggableChat';
import AssistantPanel from './components/Preview/AssistantPanel';
import ChatContainer from './components/Chat/ChatContainer';
import ProjectWelcome from './components/ProjectWelcome';
import DocumentDirectory from './components/Documents/DocumentDirectory';
import DocumentViewer from './components/Documents/DocumentViewer';
import PreviewContainer from './components/Preview/PreviewContainer';
import RequirementCard from './components/Chat/RequirementCard';
import VersionPlanCard from './components/Chat/VersionPlanCard';
import DeployPanel from './components/Export/DeployPanel';
import ApiKeyModal from './components/ApiKeyModal';
import Logo from './components/Logo';
import AiAssistantIcon from './components/AiAssistantIcon';
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
// 视图切换 Tab：原左侧菜单的【对话】【预览】【部署】挪到顶部 header 中间位置。
// - chat / preview 走 setView 切视图；
// - deploy 不属于视图，单独触发部署弹窗（智能部署向导）。
const VIEW_TABS = [
  { key: 'chat', icon: '💬', label: '对话' },
  { key: 'preview', icon: '🔍', label: '预览' },
  { key: 'documents', icon: '📚', label: '文档' },
  { key: 'deploy', icon: '🚀', label: '部署' },
] as const;

// 右侧面板持久化 key + 尺寸边界常量
const RIGHT_WIDTH_KEY = 'freecoder.rightPanelWidth';
const RIGHT_COLLAPSED_KEY = 'freecoder.rightPanelCollapsed';
const RIGHT_MIN = 220;
const RIGHT_MAX = 520;
const RIGHT_DEFAULT = 288;
// 窄屏阈值：低于该宽度时改为抽屉（drawer）模式，避免挤压主区
const NARROW_THRESHOLD = 720;

/** 从 localStorage 读取上次保存的右侧面板宽度（带 fallback + clamp） */
const readStoredWidth = (): number => {
  try {
    const saved = localStorage.getItem(RIGHT_WIDTH_KEY);
    if (saved) {
      const n = Number(saved);
      if (Number.isFinite(n)) return Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, n));
    }
  } catch {
    /* 隐私模式等：直接走默认值 */
  }
  return RIGHT_DEFAULT;
};

export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  /** 需求审查发现矛盾后为 true：卡片显示"跳过审查"逃生口 */
  const [reviewPending, setReviewPending] = useState(false);
  /** 文档主工作区当前选中的项目相对路径 */
  const [selectedDocumentPath, setSelectedDocumentPath] = useState<string | null>(null);
  const selectDocument = useCallback((path: string) => setSelectedDocumentPath(path), []);
  /** 右侧面板宽度（拖动分隔条调整，220~520px，默认 288px）；持久化到 localStorage */
  const [rightWidth, setRightWidthState] = useState<number>(readStoredWidth);
  /** 右侧面板是否折叠（双击分隔条切换）；持久化到 localStorage */
  const [rightCollapsed, setRightCollapsedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RIGHT_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  /** 窄屏抽屉是否打开（仅 NARROW_THRESHOLD 以下生效） */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** 切换主工作区时关闭窄屏抽屉，避免带入其他工作区的旧内容 */
  /** 窗口宽度（监听 resize，低于阈值时切抽屉模式） */
  const [windowWidth, setWindowWidth] = useState<number>(() => window.innerWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  /** 写入宽度：clamp 后同步到 localStorage */
  const setRightWidth = useCallback((w: number) => {
    const clamped = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, w));
    setRightWidthState(clamped);
    try {
      localStorage.setItem(RIGHT_WIDTH_KEY, String(clamped));
    } catch {
      /* 隐私模式或存储满：忽略 */
    }
  }, []);

  /** 写入折叠状态：持久化 */
  const setRightCollapsed = useCallback((c: boolean) => {
    setRightCollapsedState(c);
    try {
      localStorage.setItem(RIGHT_COLLAPSED_KEY, c ? '1' : '0');
    } catch {
      /* 忽略 */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setRightCollapsed(!rightCollapsed);
  }, [rightCollapsed, setRightCollapsed]);

  // 监听窗口尺寸，决定走"嵌入面板"还是"抽屉"布局
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isNarrow = windowWidth < NARROW_THRESHOLD;

  // 窗口变宽自动关闭抽屉（避免抽屉开着覆盖已经能放下的右侧面板）
  useEffect(() => {
    if (!isNarrow && drawerOpen) setDrawerOpen(false);
  }, [isNarrow, drawerOpen]);

  /** 拖动分隔条：左右拖动调整预览区/右侧面板宽度。折叠态下拖动会自动展开。 */
  const startResize = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    // 折叠态下拖动 → 自动展开，避免出现"拖动无效"的迷惑
    if (rightCollapsed) setRightCollapsed(false);
    dragRef.current = { startX: e.clientX, startWidth: rightWidth };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // 向右拖 → 面板变窄、预览变宽；向左拖 → 面板变宽、预览变窄
      const next = d.startWidth + (d.startX - ev.clientX);
      setRightWidth(next);
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
  /** 切换项目时清空旧项目的文档选择，目录重新扫描后自动选中首项 */
  useEffect(() => {
    setSelectedDocumentPath(null);
  }, [currentProjectId]);
  const currentView = useUiStore((s) => s.currentView);
  const setView = useUiStore((s) => s.setView);
  // 切换主工作区时关闭窄屏抽屉；按钮本身只改变抽屉状态，不触发视图切换
  useEffect(() => {
    setDrawerOpen(false);
  }, [currentView]);
  const aiChatHidden = useUiStore((s) => s.aiChatHidden);
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
  const autoTestPlan = useChatStore((s) => s.autoTestPlan);
  const autoTestCurrentStep = useChatStore((s) => s.autoTestCurrentStep);
  const autoTestStartedAt = useChatStore((s) => s.autoTestStartedAt);
  const autoTestExpectedDurationMs = useChatStore((s) => s.autoTestExpectedDurationMs);
  const autoTestLatestToolLabel = useChatStore((s) => s.autoTestLatestToolLabel);
  const autoTestLastSummary = useChatStore((s) => s.autoTestLastSummary);
  const devProgress = useChatStore((s) => s.devProgress);
  const lastTestReport = useChatStore((s) => s.lastTestReport);
  const interruptBanner = useChatStore((s) => s.interruptBanner);
  const lastTestFixAt = useChatStore((s) => s.lastTestFixAt);
  const clearInterruptBanner = useCallback(
    () => useChatStore.getState().setInterruptBanner(null),
    [],
  );
  /**
   * 「一键修复」修复完成衔接：发送指令前先记录时间戳，
   * AssistantPanel 据此在 30s 窗口内 + verdict≠pass + 不在处理中时显示「建议再测一次」提示卡。
   * 与 `onSendModify` 的语义边界：onSendModify 给元素修改（ElementInspector），不计入修复时间。
   */
  const onSendModifyFix = useCallback(
    (instruction: string): void => {
      useChatStore.getState().setLastTestFixAt(Date.now());
      void sendMessage(instruction);
    },
    [sendMessage],
  );
  /** 关闭「建议再测一次」提示卡（用户点了「稍后」），等价于清空 lastTestFixAt。 */
  const clearSuggestRetest = useCallback(
    () => useChatStore.getState().setLastTestFixAt(null),
    [],
  );
  const apiKeyConfigured = useUiStore((s) => s.apiKeyConfigured);
  const setApiKeyConfigured = useUiStore((s) => s.setApiKeyConfigured);
  const openSettings = useUiStore((s) => s.openSettings);
  const openInvite = useUiStore((s) => s.openInvite);
  const openDeploy = useExportStore((s) => s.open); // v3.2：原 openExport 已统一为「打开部署向导」
  useChatEvents();

  // 离开预览元素检查器后恢复 AI 浮窗，避免切换到文档工作区时被旧状态隐藏
  useEffect(() => {
    if (currentView !== 'preview') {
      useUiStore.getState().setAiChatHidden(false);
    }
  }, [currentView]);

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
        // 测试完成后：phaseText / action 按 verdict 切换，引导进入完成态后的下一动作
        if (lastTestReport) {
          const issueTotal = lastTestReport.issues.length;
          const highTotal = lastTestReport.issues.filter((i) => i.severity === 'high').length;
          let phaseText = '';
          if (lastTestReport.verdict === 'pass') {
            phaseText = '测试通过，可以放心导出部署包';
          } else if (lastTestReport.verdict === 'warn') {
            phaseText = `发现 ${issueTotal} 个非阻塞问题，建议先修复再导出`;
          } else {
            phaseText = `发现 ${highTotal} 个阻塞问题，暂不可上线`;
          }
          return {
            projectId: currentProjectId,
            projectName: name,
            phaseText,
            action: 'auto-test',
            actionText: '🧪 再测一次',
          };
        }
        // 未出过结构化报告：用户可能从未点过测试，也可能上次点击后被中断。
        // - 仍在跑（autoTestRunning=true）：按钮换成「测试未完成，继续」，避免误导用户
        //   重复触发；同时 phaseText 引导去右上方 📌 进度 Tab 看实时步骤
        // - 未在跑：首次或可重新开始的入口，保持原文案
        const testInProgress = autoTestRunning;
        return {
          projectId: currentProjectId,
          projectName: name,
          phaseText: testInProgress
            ? '自动测试还在进行中，右侧 📌 进度 Tab 可看实时步骤与耗时。点下面的按钮可继续触发。'
            : '应用已就绪，正在预览。选择下面的方式开始测试吧：',
          action: 'none',
          actionText: '',
          actions: [
            { action: 'open-browser', label: '🌐 用浏览器打开看看效果' },
            {
              action: 'auto-test',
              label: testInProgress ? '🧪 测试未完成，继续' : '🧪 已经 ok，请帮我测试',
            },
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
    lastTestReport,
    autoTestRunning,
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

  /**
   * 渲染右侧面板：
   * - 宽屏（isNarrow=false）：嵌入主区 + 可拖动分隔条 + 双击分隔条折叠/展开；
   * - 窄屏（isNarrow=true）：右侧面板改为 fixed 浮动抽屉，需要时通过浮动按钮打开。
   * chat / preview 两个视图都通过这个函数渲染，避免重复实现"分隔条 + 折叠"与"抽屉"两套 UI。
   */
  const renderRightPanel = (
    asideContent: ReactNode,
    panelLabel: string,
    drawerLabel: ReactNode,
    drawerTitle: ReactNode,
  ) => {
    if (isNarrow) {
      return (
        <>
          {/* 浮动按钮：fixed 在主区域右上，点击展开抽屉 */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="fixed right-4 top-16 z-30 flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-colors hover:bg-brand-hover"
          >
            <span>{drawerLabel}</span>
          </button>
          {/* 抽屉覆盖层：半透明遮罩 + 右侧抽屉面板 */}
          {drawerOpen && (
            <>
              <div
                className="fixed inset-0 z-40 bg-black/30"
                onClick={() => setDrawerOpen(false)}
              />
              <aside
                aria-label={panelLabel}
                className="fixed right-0 top-0 z-50 flex h-full w-80 max-w-[85vw] flex-col bg-slate-50 shadow-xl"
              >
                <header className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 px-4">
                  <span className="text-sm font-medium text-slate-700">{drawerTitle}</span>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="text-slate-400 hover:text-slate-600"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">{asideContent}</div>
              </aside>
            </>
          )}
        </>
      );
    }
    // 宽屏：嵌入模式（可拖动分隔条 + 双击折叠）
    const collapsed = rightCollapsed;
    return (
      <>
        <div
          role="separator"
          aria-orientation="vertical"
          title="拖动调整宽度；双击折叠/展开"
          onMouseDown={startResize}
          onDoubleClick={toggleCollapsed}
          className="group relative w-1.5 shrink-0 cursor-col-resize"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-200 transition-colors group-hover:bg-brand group-active:bg-brand" />
          {collapsed && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-base leading-none text-slate-300 transition-opacity group-hover:text-brand">
              ‹
            </div>
          )}
        </div>
        <aside
          aria-label={panelLabel}
          className={`flex shrink-0 flex-col bg-slate-50 transition-[width] duration-150 ${
            collapsed ? 'overflow-hidden' : ''
          }`}
          style={{ width: collapsed ? 0 : rightWidth }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{asideContent}</div>
        </aside>
      </>
    );
  };

  return (
    <div className="flex h-screen flex-col bg-white text-slate-800">
      {/* 标题栏：左 = 品牌区，中 = 视图 Tab，右 = API 状态 + 设置 */}
      <header className="flex h-12 shrink-0 items-center border-b border-slate-200 px-4">
        {/* 左侧：Logo / 标题 / 版本号 / 项目切换 */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Logo size={22} />
          <h1 className="text-base font-semibold">FreeCoder</h1>
          {appInfo && <span className="text-xs text-slate-400">v{appInfo.version}</span>}
          {/* 项目切换器（列表 + 新建入口） */}
          {projects.length > 0 && <ProjectSwitcher />}
        </div>
        {/* 中间：主功能 Tab（对话 / 预览 / 文档 / 部署） */}
        <nav
          className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100/70 p-1"
          aria-label="主导航"
        >
          {VIEW_TABS.map((tab) => {
            const isDeploy = tab.key === 'deploy';
            const isActive = !isDeploy && currentView === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => (isDeploy ? openDeploy() : setView(tab.key))}
                title={tab.label}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors ${
                  isActive
                    ? 'bg-white font-medium text-brand shadow-sm'
                    : 'text-slate-500 hover:bg-white/60'
                }`}
              >
                <span className="text-sm leading-none">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        {/* 右侧：API 状态徽章 + 设置 */}
        <div className="flex flex-1 items-center justify-end gap-2">
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

      {/* 主流程步骤条：文档主工作区独立阅读，不占用步骤条空间 */} 
      {currentProjectId && currentView !== 'documents' && (
        <StepFlow
          status={projectStatus}
          onGoChat={() => setView('chat')}
          onGoPreview={() => setView('preview')}
        />
      )}

      {/* 主体：工作区 + 右侧面板（chat 视图才有右侧面板，preview 视图交给 AI 助理浮窗） */}
      <main className="flex flex-1 overflow-hidden">
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
          ) : currentView === 'preview' ? (
            <PreviewContainer />
          ) : currentView === 'documents' ? (
            <DocumentViewer
              key={`${currentProjectId}:${selectedDocumentPath ?? 'empty'}`}
              projectId={currentProjectId}
              selectedPath={selectedDocumentPath}
            />
          ) : null}
        </section>
        {/* 右侧面板：chat 显示需求/版本计划，documents 显示目录树，preview 显示 AI 助理。
            宽屏：嵌入 + 可拖动分隔条 + 双击折叠；窄屏：自动改为浮动抽屉。
            AI 助理聊天浮窗统一由 App 末尾的全局 <DraggableChat /> 渲染，跨视图共享同一实例。 */}
        {currentProjectId && currentView === 'chat' &&
          renderRightPanel(
            requirements ? (
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
            ),
            '需求与版本计划面板',
            '📋 打开需求',
            '📋 需求与计划',
          )}
        {/* 文档主工作区：中央渲染内容，右侧显示项目文档与图片目录树 */}
        {currentProjectId && currentView === 'documents' &&
          renderRightPanel(
            <DocumentDirectory
              projectId={currentProjectId}
              selectedPath={selectedDocumentPath}
              onSelect={selectDocument}
            />,
            '项目文档目录',
            '📂 打开目录',
            '📂 文档目录',
          )}
        {/* preview 视图右侧面板：AI 助理（📌 进度 / 🔍 元素 / 💬 开发日志）。
            底部 MiniChat 已统一到 App 末尾的全局 <DraggableChat />。 */}
        {currentProjectId && currentView === 'preview' &&
          renderRightPanel(
            <AssistantPanel
              resumeGuide={resumeGuide}
              onResumeAction={handleResumeAction}
              autoTestRunning={autoTestRunning}
              autoTestLatestProgress={autoTestLatestProgress}
              autoTestPlan={autoTestPlan}
              autoTestCurrentStep={autoTestCurrentStep}
              autoTestStartedAt={autoTestStartedAt}
              autoTestExpectedDurationMs={autoTestExpectedDurationMs}
              autoTestLatestToolLabel={autoTestLatestToolLabel}
              autoTestLastSummary={autoTestLastSummary}
              selectedElement={selectedElement}
              elementInfo={elementInfo}
              isProcessing={isProcessing}
              devProgress={devProgress}
              lastTestReport={lastTestReport}
              onViewReport={() => setView('chat')}
              onOpenDeploy={() => openDeploy()}
              onSendModify={(instruction) => void sendMessage(instruction)}
              onSendModifyFix={onSendModifyFix}
              lastTestFixAt={lastTestFixAt}
              clearSuggestRetest={clearSuggestRetest}
              interruptBanner={interruptBanner}
              clearInterruptBanner={clearInterruptBanner}
            />,
            'AI 助理面板',
            <span className="flex items-center gap-1.5">
              <AiAssistantIcon size={14} className="shrink-0" withSparkle={false} />
              AI 助理
            </span>,
            <span className="flex items-center gap-1.5">
              <AiAssistantIcon size={16} className="shrink-0" withSparkle={false} />
              AI 助理
            </span>,
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

      {/* 智能部署面板（v3.2：替代原 ExportPanel，含一键启动 / 智能打包 / 部署指引 / 高级导出四大支柱） */}
      <DeployPanel />

      {/* 首次启动 / 设置弹窗（欢迎态由 ui store 的 inviteMode 原子驱动） */}
      <ApiKeyModal
        onSaved={refreshSettings}
        initialProvider={settings?.provider}
        initialBaseUrl={settings?.baseUrl}
        initialModel={settings?.model}
        initialApiKeyMasked={settings?.apiKeyMasked}
      />

      {/* AI 助理聊天浮窗（全局唯一）：chat / preview 视图共享同一实例，
          切换视图时位置 / 最小化状态 / 输入框内容 / 滚动位置全部跨视图保持，
          让用户感觉「切换【对话 / 预览】时 AI 助理没换，还是那一个」。 */}
      {currentProjectId && (
        <DraggableChat
          placeholder={
            currentView === 'preview'
              ? '和 AI 聊聊，比如：标题颜色太深 / 继续开发 / 选中元素后会自动带上…'
              : currentView === 'documents'
                ? '和 AI 聊聊当前文档或项目，比如：帮我补一份 README'
                : '和 AI 聊聊当前需求，比如：不是说先不搞登录吗？'
          }
          marqueeOnProcessing={currentView === 'preview' || currentView === 'documents'}
          marqueeText={autoTestRunning ? '🧪 测试中…' : 'AI 正在处理中'}
          hidden={aiChatHidden}
        />
      )}
    </div>
  );
}
