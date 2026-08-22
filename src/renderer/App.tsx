import { useCallback, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatContainer from './components/Chat/ChatContainer';
import ProjectWelcome from './components/ProjectWelcome';
import PreviewContainer from './components/Preview/PreviewContainer';
import ElementInspector from './components/Preview/ElementInspector';
import RequirementCard from './components/Chat/RequirementCard';
import VersionPlanCard from './components/Chat/VersionPlanCard';
import ExportPanel from './components/Export/ExportPanel';
import ApiKeyModal from './components/ApiKeyModal';
import Logo from './components/Logo';
import StepFlow from './components/StepFlow';
import { useChatStore } from './store/chat';
import { useProjectStore } from './store/project';
import { useUiStore } from './store/ui';
import { useExportStore, handleExportComplete } from './store/export';
import { useChatEvents } from './hooks/useChatEvents';
import type { AppInfo } from '@shared/types/app';
import type { AppSettings } from '@shared/types/settings';
import type { VersionPlan } from '@shared/types/project';

/** 主界面：三栏式布局（前端设计说明书 2.1） */
export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
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
  const apiKeyConfigured = useUiStore((s) => s.apiKeyConfigured);
  const setApiKeyConfigured = useUiStore((s) => s.setApiKeyConfigured);
  const openSettings = useUiStore((s) => s.openSettings);
  const openInvite = useUiStore((s) => s.openInvite);
  const openExport = useExportStore((s) => s.open);
  useChatEvents();

  const currentProject = currentProjectId
    ? (projects.find((p) => p.id === currentProjectId) ?? null)
    : null;

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

  // 项目切换时加载项目上下文（需求 + 状态 + 版本计划）
  useEffect(() => {
    if (!currentProjectId) return;
    // 同步到对话 store（sendMessage 依赖）
    useChatStore.getState().setProject(currentProjectId);
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

  const handleConfirm = async () => {
    if (!currentProjectId) return;
    // 确认需求 → 进入版本分段阶段（planned），计划由主进程后台生成
    setProjectStatus('planned');
    try {
      await window.electron.project.confirm({ projectId: currentProjectId });
    } catch {
      setProjectStatus('draft');
    }
  };

  const handleConfirmPlan = async (plan: VersionPlan) => {
    if (!currentProjectId) return;
    setProjectStatus('developing');
    try {
      const result = await window.electron.project.confirmPlan({
        projectId: currentProjectId,
        plan,
      });
      if (!result.success) setProjectStatus('planned');
    } catch {
      setProjectStatus('planned');
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
          {currentProject && (
            <span className="ml-2 flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
              📁 {currentProject.name}
            </span>
          )}
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

      {/* 主体：侧栏 + 工作区 + 右侧面板 */}
      <main className="flex flex-1 overflow-hidden">
        <Sidebar />
        <section className="flex-1 overflow-hidden">
          {!currentProjectId ? (
            <ProjectWelcome />
          ) : currentView === 'chat' ? (
            <ChatContainer />
          ) : (
            <PreviewContainer />
          )}
        </section>
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4">
          {!currentProjectId ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
              创建项目后，这里会显示需求卡片或元素信息
            </div>
          ) : currentView === 'preview' ? (
            selectedElement && elementInfo ? (
              <ElementInspector
                element={selectedElement}
                info={elementInfo}
                isProcessing={isProcessing}
                onSendModify={(instruction) => void sendMessage(instruction)}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
                🔍 元素信息
                <br />
                <span className="mt-1 block">在预览中悬停/点击任意元素查看信息</span>
              </div>
            )
          ) : requirements ? (
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
                onConfirm={() => void handleConfirm()}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
              📋 需求卡片
              <br />
              <span className="mt-1 block">完成需求对话后，这里会显示整理好的需求</span>
            </div>
          )}
        </aside>
      </main>

      {/* 状态栏 */}
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-slate-200 px-4 text-xs text-slate-400">
        <span>
          {apiKeyConfigured === true
            ? '● 大模型 API 已配置（本地加密存储）'
            : apiKeyConfigured === false
              ? '● 尚未配置大模型 API，点击右上角配置'
              : '● 正在加载设置…'}
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
      />
    </div>
  );
}
