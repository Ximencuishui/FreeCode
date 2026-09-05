import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
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
import DeployView from './components/Export/DeployView';
import ApiKeyModal from './components/ApiKeyModal';
import Logo from './components/Logo';
import AiAssistantIcon from './components/AiAssistantIcon';
import StepFlow from './components/StepFlow';
import { DshStatusBadge } from './components/DshStatusBadge';
import { useChatStore, type ResumeGuide, type ResumeAction } from './store/chat';
import { useProjectStore } from './store/project';
import { useUiStore } from './store/ui';
import { useExportStore, handleExportComplete } from './store/export';
import { useChatEvents } from './hooks/useChatEvents';
import { useDshState } from './hooks/useDshState';
import { useDeploymentReadyToast } from './hooks/useDeploymentReadyToast';
import NotificationHost from './components/common/NotificationHost';
import type { AppInfo } from '@shared/types/app';
import type { AppSettings, SettingsGetResult } from '@shared/types/settings';
import type {
  VersionPlan,
  RequirementSummary,
  TestIssue,
  ProjectGetResult,
  ProjectResumeDevelopmentResult,
} from '@shared/types/project';
import type { ExportCompleteEvent } from '@shared/types/export';
import type { PreviewOpenExternalResult } from '@shared/types/preview';

/** 主界面：三栏式布局（前端设计说明书 2.1） */
// 视图切换 Tab（v3.2.2 P0-1 重构）：四个 Tab 全部走 setView 切换持久化视图，
// 包括「🚀 部署」——从原来的「点击打开弹窗」改为「切换到 DeployView 视图」。
// type as const 保证 key 的字面量类型与 AppView 严格对齐；
// 'deploy' 已在 ui.ts 的 AppView 中声明。
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
  /** 方案 3：实时订阅 dsh 状态机（idle 休眠 / running / missing 等），供状态栏渲染 */
  const dshState = useDshState();
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
  // v3.2.2 P0-5：记住上一个 currentProjectId，effect 里用它调 cancelActiveTasks
  const prevProjectIdRef = useRef<string | null>(null);
  /**
   * 元素选择模式（selectMode）：由 App 统一持有，作为唯一真源。
   * - PreviewContainer 通过 selectMode 同步给 webview 的 inspector.js（关掉预览可正常点击测试）
   * - AssistantPanel 通过 selectMode 渲染「🔍 元素」Tab 顶部的开关按钮
   * 切项目时重置为 false（避免旧项目的选择模式污染新项目 webview 的初始态）。
   */
  const [selectMode, setSelectMode] = useState(false);

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
  // v0.1.02 P1-1：窗口变窄自动收起右侧面板 + 关闭抽屉，避免出现"宽屏已展开但窄屏又是折叠态"的视觉割裂；
  // 窗口变宽时反向同步：宽屏下若抽屉打开，强制关掉（由抽屉态切换到嵌入态）。
  // 注意：依赖数组只放 [isNarrow]，不要把 rightCollapsed / drawerOpen 放进来——
  // 否则在用户主动 setDrawerOpen(true) 后，effect 会立刻把它打回 false，导致窄屏下抽屉永远打不开。
  useEffect(() => {
    if (isNarrow) {
      // 进入窄屏：抽屉态接管，强制 rightCollapsed=true（避免抽屉半透明时还看到嵌入面板）。
      // 同时若抽屉已开（理论上窄屏默认关闭，这里只兜底），也强制关闭防止半透明叠加。
      setRightCollapsedState(true);
      setDrawerOpen(false);
    } else if (drawerOpen) {
      // 退出窄屏：抽屉态切回嵌入态。
      setDrawerOpen(false);
    }
  }, [isNarrow]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // v3.2.2 P0-5：同一 effect 里追加「取消旧项目后台任务」——
  //   用 useRef 记录 prev projectId；只有从 A → B 才需要取消 A，避免首屏 / 刷新时无意义的 IPC。
  //   三个 cancel（dev / export / package）由 store 内部并发 + allSettled，
  //   单个失败不影响其他，也不阻塞切项目流程（主进程各 cancel 通道返回快，~ms 级）。
  // 同时重置 selectMode：避免上一个项目残留的"选元素模式"在新项目 webview 里持续生效。
  // P0 审计修复：切项目时调 dismissAllNotifications —— NotificationHost 在 App 顶层挂载不卸载，
  // 旧通知（如「A 项目已就绪」）会跨项目残留，action.onClick 还会跳到 B 项目的部署视图。
  useEffect(() => {
    setSelectedDocumentPath(null);
    setSelectMode(false);
    const prev = prevProjectIdRef.current;
    if (prev && prev !== currentProjectId) {
      void useChatStore.getState().cancelActiveTasks(prev);
      useUiStore.getState().dismissAllNotifications();
    }
    prevProjectIdRef.current = currentProjectId;
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
  // v3.2.1 P1-6：自动测试连续失败次数，用于 AssistantPanel InterruptBanner 展示「第 N/3 次重试」
  const autoTestRetryCount = useChatStore((s) => s.autoTestRetryCount);
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
  // v3.2.1 P2-12：测试 overtime 时「立即中断」按钮回调。用 useCallback 稳定引用，
  // AssistantPanel 暂未 memo，但保留稳定引用对未来加 React.memo 不留隐患。
  const handleStopAutoTest = useCallback(() => {
    void useChatStore.getState().stopTask();
  }, []);
  /** 关闭「建议再测一次」提示卡（用户点了「稍后」），等价于清空 lastTestFixAt。 */
  const clearSuggestRetest = useCallback(
    () => useChatStore.getState().setLastTestFixAt(null),
    [],
  );
  const apiKeyConfigured = useUiStore((s) => s.apiKeyConfigured);
  const setApiKeyConfigured = useUiStore((s) => s.setApiKeyConfigured);
  const openSettings = useUiStore((s) => s.openSettings);
  const openInvite = useUiStore((s) => s.openInvite);
  // v3.2.2 P0-1 重构：openDeploy / deployVisible 已删除（原 useExportStore 模态控制）。
  // 「🚀 部署」Tab 现在是持久化视图，与 chat / preview / documents 平等；
  // 跳转通过 setView('deploy') 完成，不依赖 store 副作用。
  useChatEvents();
  // P0 建议 3：监听 projectStatus 从 developing → ready/exported 的边沿，
  // 通过 ui store push 一条全局通知。详见 useDeploymentReadyToast 注释。
  useDeploymentReadyToast();

  // 离开预览元素检查器后恢复 AI 浮窗，避免切换到文档工作区时被旧状态隐藏
  // v0.1.02 P0-1：useLayoutEffect 在浏览器绘制前同步执行，避免切视图瞬间浮窗延迟出现。
  useLayoutEffect(() => {
    if (currentView !== 'preview') {
      useUiStore.getState().setAiChatHidden(false);
    }
  }, [currentView]);

  // 订阅导出完成事件
  useEffect(() => {
    const unsub = window.electron.export.onComplete((data: ExportCompleteEvent) =>
      handleExportComplete(data),
    );
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
      .then(({ settings: s }: SettingsGetResult) => {
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
      .then(({ settings: s }: SettingsGetResult) => {
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
      .then((result: ProjectGetResult) => {
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
        .then((result: ProjectGetResult) => {
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
        .then((result: ProjectGetResult) => {
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
    [currentProjectId, setProjectStatus],
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

  /**
   * 保存需求卡片的编辑结果（持久化 + 必要时回滚副作用）。
   * P0-3（需求二次编辑副作用回滚）：
   * 当项目状态已经在 confirmed 之后（planned/developing/ready/exported），
   * 且本次编辑改动的是「核心字段」（目标 / 目标用户 / 核心功能 / 关键流程），
   * 则把项目状态回滚到 draft、清空版本计划、并推一条系统消息，
   * 强制用户重新走「确认需求 → 重新规划」的链路，避免旧版本计划 / 旧测试报告与新需求错位。
   * 非核心字段（视觉风格 / 页面 / 设备 / 登录方式 等）的修改不会触发回滚，
   * 保留项目状态，只在确认弹窗里告知用户"附属字段不影响版本计划"。
   */
  const handleUpdateRequirements = useCallback(
    async (patch: Partial<RequirementSummary>): Promise<boolean> => {
      if (!currentProjectId) return false;
      const current = useChatStore.getState().requirements;
      if (!current) return false;
      // 编辑前的项目状态——下面要根据这个判断是否需要回滚。
      const statusBefore = useChatStore.getState().projectStatus;
      const isPostConfirmation =
        statusBefore === 'planned' ||
        statusBefore === 'developing' ||
        statusBefore === 'ready' ||
        statusBefore === 'exported';
      // 核心字段变化检测：只关心用户真正改动了哪些"决定项目是什么"的字段。
      // 数组用 JSON.stringify 比较是可行的——字段量很小（< 20 项），开销忽略不计，
      // 而且 editor 总是把当前值完整 push 过来（不传 undefined），不会因 patch 缺字段漏判。
      const coreChanged =
        (patch.goal ?? '').trim() !== (current.goal ?? '').trim() ||
        (patch.targetUsers ?? '').trim() !== (current.targetUsers ?? '').trim() ||
        JSON.stringify(patch.coreFeatures ?? []) !==
          JSON.stringify(current.coreFeatures ?? []) ||
        JSON.stringify(patch.keyFlows ?? []) !==
          JSON.stringify(current.keyFlows ?? []);
      try {
        const result = await window.electron.project.updateRequirements({
          projectId: currentProjectId,
          requirements: patch,
        });
        if (!result.success) {
          return false;
        }
        // 保留原 confirmed 标志——confirmed 表示用户曾点过"确认需求"，不是字段校验。
        setRequirements({ ...current, ...patch, confirmed: current.confirmed });
        // 回滚副作用：仅在「已确认后 + 核心字段改动」时触发；其他情况直接成功返回。
        if (isPostConfirmation && coreChanged) {
          setProjectStatus('draft');
          setVersionPlan(null);
          // 用 sessionId 让系统消息独立于主对话流，便于后续 cleanMessagesBySession 清理。
          useChatStore.getState().pushMessage({
            role: 'system',
            content:
              '🔄 检测到核心需求变更（目标 / 目标用户 / 核心功能 / 关键流程），已自动回滚项目状态到「草稿」。\n\n版本计划已失效，请重新确认需求以生成新的版本计划。',
            metadata: {
              channel: 'requirement-rollback',
              sessionId: `requirement-rollback-${currentProjectId}`,
            },
          });
        }
        return true;
      } catch {
        /* 失败返回 false，由卡片提示 */
        return false;
      }
    },
    [currentProjectId, setRequirements, setProjectStatus, setVersionPlan],
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
          const highTotal = lastTestReport.issues.filter((i: TestIssue) => i.severity === 'high').length;
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
          ? flows.map((f: string, i: number) => `${i + 1}. ${f}`).join('\n')
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
        .then((result: PreviewOpenExternalResult) => {
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
      // v0.1.02 P0-3：每次主动触发 auto-test（含 InterruptBanner 自动/手动重试入口）都清零失败计数，
      // 给用户新一轮的 3 次自动重试机会，避免点一次重试就被永久卡在"已达上限"。
      if (currentProjectId) {
        // v0.1.02 P3-7：用户主动重测时清空所有上次测试的残留状态：
        // - interruptBanner：旧的中断原因 banner 不应残留（会被 InterruptBanner 渲染为"上一轮失败"）
        // - lastTestFixAt：上一次"建议再测一次"的时间戳，避免 SuggestRetestCard 误判 30s 窗口
        // - autoTestLatestProgress：保证新一轮的"已收到指令…"立刻盖掉旧进度
        // - autoTestToolCount / autoTestPlan：清掉 step 进度推断的旧值
        const store = useChatStore.getState();
        store.resetAutoTestRetry();
        store.setInterruptBanner(null);
        store.setLastTestFixAt(null);
        store.resetAutoTestPlan();
        store.setAutoTestRunning(true);
        store.setAutoTestLatestProgress('🧪 已收到指令，正在准备测试环境…');
        store.appendDevProgress('🧪 已收到"一键测试"指令，开始编写测试用例并审计代码…');
        void window.electron.project
          .autoTest({ projectId: currentProjectId })
          .catch((err: unknown) => {
            // 主进程异常时也要复位"测试中"状态，避免右侧一直转圈
            useChatStore.getState().setAutoTestRunning(false);
            useChatStore.getState().setAutoTestLatestProgress(null);
            console.warn('[FreeCoder] 一键测试失败：', err);
          });
      }
    } else if (action === 'auto-test-retry') {
      // v0.1.02 P3-AUDIT：InterruptBanner 倒计时到点触发的内部重试。
      // 与用户主动 'auto-test' 的关键差异：不调用 resetAutoTestRetry()，
      // 否则 counter 永远停在 1，P0-3 的 "3 次失败上限 / 指数退避" 完全失效，
      // 失败 → 5s 重试 → 再失败 → 5s 重试 → … 死循环跑 DSH。
      // 这里其它清理（中断 banner / lastTestFixAt / progress）跟用户主动重测一致，
      // 反正 banner 自己已经被另一个 useEffect 渲染中保留到重试触发。
      if (currentProjectId) {
        const store = useChatStore.getState();
        store.setInterruptBanner(null);
        store.setLastTestFixAt(null);
        store.resetAutoTestPlan();
        store.setAutoTestRunning(true);
        store.setAutoTestLatestProgress('🧪 自动重试中（已达 ' + store.autoTestRetryCount + ' 次连续失败）…');
        store.appendDevProgress('🔁 自动重试（第 ' + (store.autoTestRetryCount + 1) + ' 次）…');
        void window.electron.project
          .autoTest({ projectId: currentProjectId })
          .catch((err: unknown) => {
            useChatStore.getState().setAutoTestRunning(false);
            useChatStore.getState().setAutoTestLatestProgress(null);
            console.warn('[FreeCoder] 自动重试失败：', err);
          });
      }
    } else if (action === 'refresh-status' && currentProjectId) {
      // 继续开发：先触发恢复，成功后引导卡切换为"开发中"；再刷新最新状态
      void window.electron.project
        .resumeDevelopment({ projectId: currentProjectId })
        .then((result: ProjectResumeDevelopmentResult) => {
          if (result.success) setDevTaskRunning(true);
        })
        .catch(() => undefined);
      window.electron.project
        .get({ projectId: currentProjectId })
        .then((result: ProjectGetResult) => {
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
          {/* 浮动按钮：fixed 在主区域右上，点击展开抽屉
              v0.1.02 P1-7：原来在 top-16（64px）会与窄屏下的顶部 Tab 内容重叠。
              下移到 top-14（56px）+ 收紧 padding，避免遮挡 Tab 文本。 */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={`展开${panelLabel}`}
            className="fixed right-3 top-14 z-30 flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-medium text-white shadow-lg transition-colors hover:bg-brand-hover"
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
      {/* P0 建议 3：全局通知宿主，挂一次即可；内部订阅 useUiStore.notifications，
          按入队顺序渲染右下角浮层。位置独立 fixed，不影响布局。 */}
      <NotificationHost />
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
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              title={tab.label}
              aria-label={tab.label}
              aria-current={currentView === tab.key ? 'page' : undefined}
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors ${
                currentView === tab.key
                  ? 'bg-white font-medium text-brand shadow-sm'
                  : 'text-slate-500 hover:bg-white/60'
              }`}
            >
              <span className="text-sm leading-none" aria-hidden="true">
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
        {/* 右侧：全局 AI 思考指示（修复 P1-1）+ API 状态徽章 + 设置 */}
        <div className="flex flex-1 items-center justify-end gap-2">
          {/* 修复 P1-1：全局 AI 思考指示，统一 ChatContainer / AssistantPanel / VersionPlanCard
              三处独立等待 UI 的视觉。isProcessing 时显示 amber 脉冲徽章 + 一个轻量的跑马灯词，
              用户在 chat / preview / documents 任何视图都能看到「还在跑」。非处理中时只保留
              一个极小的「●」占位，避免画布抖动。 */}
          {isProcessing ? (
            <span
              className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
              data-testid="app-ai-thinking-chip"
              aria-live="polite"
              aria-atomic="true"
              title={autoTestRunning ? '测试进行中…' : 'AI 正在处理…'}
            >
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
                aria-hidden="true"
              />
              <span>{autoTestRunning ? '测试进行中…' : 'AI 思考中…'}</span>
            </span>
          ) : (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/60"
              aria-hidden="true"
              title="AI 空闲"
            />
          )}
          <button
            type="button"
            onClick={() => {
              // v0.1.02 P3-6：null 表示"还在从主进程读"，不是"没配置"。
              // 之前只在 apiKeyConfigured !== true 时打开弹窗（这个已经满足），但按钮
              // 视觉态是 cursor-default + 灰底，null 期间点击像"按钮坏了"。
              // 现在 null 也允许点击（打开配置面板占位），且视觉上 cursor-pointer + hover。
              openSettings();
            }}
            title={
              apiKeyConfigured === true
                ? '大模型 API 已配置（点击查看）'
                : apiKeyConfigured === false
                  ? '尚未配置大模型 API，点击配置'
                  : '加载中…（点击打开配置）'
            }
            // v0.1.02 P3-6：null 态视觉态改为 cursor-pointer + hover 反馈，让用户感知可点击。
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
              apiKeyConfigured === true
                ? 'cursor-default bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                : apiKeyConfigured === false
                  ? 'cursor-pointer bg-amber-50 text-amber-600 hover:bg-amber-100'
                  : 'cursor-pointer bg-slate-50 text-slate-400 hover:bg-slate-100'
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
          onGoDeploy={() => setView('deploy')}
        />
      )}

      {/* 主体：工作区 + 右侧面板（chat 视图才有右侧面板，preview 视图交给 AI 助理浮窗） */}
      {/* v3.2.1 P3-9：工作区加 key={currentProjectId} 触发重渲染 + animate-fadeIn，
          项目切换时给一个柔和的淡入动画（200ms），让用户感知到「内容确实换了一份」，
          避免瞬间硬切显得突兀。keyframes 来自 tailwind.config.js。
          注意：key 只挂在工作区 <section> 上，不影响右侧面板 / 状态栏 / 全局浮窗，
          避免聊天滚动位置、需求编辑草稿等非受控状态被强制清零。 */}
      <main className="flex flex-1 overflow-hidden">
        <section
          key={currentProjectId ?? 'no-project'}
          className="flex-1 animate-fadeIn overflow-hidden"
        >
          {!currentProjectId ? (
            <ProjectWelcome />
          ) : currentView === 'chat' ? (
            <ChatContainer
              onConfirmRequirements={handleConfirm}
              resumeGuide={resumeGuide}
              onResumeAction={handleResumeAction}
              autoTestRunning={autoTestRunning}
              autoTestLatestProgress={autoTestLatestProgress}
              // 修复 P1-2：项目已交付（exported）后 MilestoneCard 的「查看部署指南」
              // 跳转到持久化的 DeployView（v3.2.2 P0-1：原为 openDeploy 弹窗）。
              onOpenDeployFromMilestone={() => setView('deploy')}
            />
          ) : currentView === 'preview' ? (
            <PreviewContainer
              selectMode={selectMode}
              onExitSelectMode={() => setSelectMode(false)}
            />
          ) : currentView === 'documents' ? (
            <DocumentViewer
              key={`${currentProjectId}:${selectedDocumentPath ?? 'empty'}`}
              projectId={currentProjectId}
              selectedPath={selectedDocumentPath}
            />
          ) : currentView === 'deploy' ? (
            // v3.2.2 P0-1 重构：部署从弹窗升级为持久化视图。
            // 仍然受「先有项目」条件保护——未选项目时不渲染，由 ProjectWelcome 兜底。
            <DeployView />
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
              // v3.2.2 P0-1 重构：AssistantPanel 的「🚀 部署」按钮跳转到持久化视图。
              onOpenDeploy={() => setView('deploy')}
              onSendModify={(instruction) => void sendMessage(instruction)}
              onSendModifyFix={onSendModifyFix}
              lastTestFixAt={lastTestFixAt}
              clearSuggestRetest={clearSuggestRetest}
              interruptBanner={interruptBanner}
              clearInterruptBanner={clearInterruptBanner}
              // v3.2.1 P1-6：把连续失败次数透传，AssistantPanel 顶部 InterruptBanner 展示「第 N/3 次重试」徽章
              autoTestRetryCount={autoTestRetryCount}
              // v3.2.1 P2-12：overtime 时允许用户在 AutoTestPlanCard 内手动中断，避免仅依赖 InterruptBanner
              onStopAutoTest={handleStopAutoTest}
              // 元素选择模式：开关放在「🔍 元素」Tab 顶部，与右侧面板共享同一份 selectMode 状态
              selectMode={selectMode}
              onToggleSelect={() => setSelectMode((v) => !v)}
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
      <footer
        className="flex h-8 shrink-0 items-center justify-between border-t border-slate-200 px-4 text-xs text-slate-400"
        role="contentinfo"
        aria-label="应用状态"
      >
        <span>
          {/* v3.2.2 P0-x：底部状态栏的「大模型 API 已配置」原本是父级 footer 的 text-slate-400
                统一灰，已配置/未配置/加载中三个状态视觉上糊成一样的灰色，无法传达"已配置"。
                这里按 apiKeyConfigured 三态切文字色，跟上面那个圆点按钮（绿/黄/灰）一致：
                true → emerald-600（已配置），false → amber-600（未配置，提醒行动），其余 → slate-400（加载中）。
              DshStatusBadge 自己有 amber/blue/slate 的徽章配色，不受这里覆盖。 */}
          <span
            className={
              apiKeyConfigured === true
                ? 'text-emerald-600'
                : apiKeyConfigured === false
                  ? 'text-amber-600'
                  : 'text-slate-400'
            }
          >
            {apiKeyConfigured === true
              ? '● 大模型 API 已配置（本地加密存储）'
              : apiKeyConfigured === false
                ? '● 尚未配置大模型 API，点击右上角配置'
                : '● 正在加载设置…'}
          </span>
          {/* 方案 3：dsh 实时状态徽章（来自 useDshState hook）。
                - loading（INITIAL）灰色脉冲"dsh 状态加载中…"——IPC 往返期间的骨架态
                - idle（常态）     灰色静态"💤 休眠中"——启动入口齐了 + 当前无任务
                - starting/running/stopping 蓝色脉冲"dsh 任务进行中"等
                - error           黄色"⚠ {message}"
                - missing         黄色"⚠ {message}（{reason}）"——启动入口缺失
              渲染规则详见 DshStatusBadge。 */}
          <DshStatusBadge state={dshState} />
        </span>
        {/* v0.1.02 P2-5：原来"项目保存在本地 · 数据不上传"易让用户困惑「本地」指什么。
            实际项目文件存在 ~/.freecoder/Project/<id>/ 下（用户机器上的固定目录），
            大模型 API Key 加密保存在本地，但需求/对话数据不上传。
            这里把"本地"指代说清楚，避免歧义。 */}
        <span className="flex items-center gap-2">
          项目文件保存在本机{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">
            ~/.freecoder/Project
          </code>
          ，需求与对话数据不上传
          {/* v3.2.1 P1-12：一键打开数据目录——之前用户想知道自己的项目放在哪只能去搜
              ~/.freecoder/，现在直接点按钮调 revealInFolder 把目录打开。 */}
          <button
            type="button"
            onClick={() => void window.electron.app.revealInFolder('~/.freecoder')}
            className="ml-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 transition-colors hover:border-brand hover:text-brand"
            title="在文件管理器中打开数据目录 ~/.freecoder"
            aria-label="打开数据目录"
            data-testid="footer-open-data-dir"
          >
            📂 打开目录
          </button>
        </span>
      </footer>

      {/* 智能部署视图（v3.2.2 P0-1 重构）：
          原「DeployPanel 弹窗」已改造为持久化视图 DeployView，在主工作区 section 里按 currentView === 'deploy' 渲染。
          由此移除此处原来的全局 <DeployPanel /> 模态挂载点 —— 不再有「弹窗去哪了」的认知负担。 */}

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
