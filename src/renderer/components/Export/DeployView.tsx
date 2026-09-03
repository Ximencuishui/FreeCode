import { useEffect, useRef, useState } from 'react';
import { useExportStore } from '../../store/export';
import { useProjectStore } from '../../store/project';
import { useChatStore } from '../../store/chat';
import { useUiStore } from '../../store/ui';
import DeployConfigWizard from './DeployConfigWizard';
import { createDefaultDeployConfig } from '@shared/types/export';
import type { DeployConfig } from '@shared/types/export';
import DeploymentAssistant from './DeploymentAssistant';
import MilestoneCard from './MilestoneCard';
import type { PackageCompleteEvent, PackageProgressEvent } from '@shared/types/package';
import { formatTestPassRate, countFilesFromDevProgress } from './deployPanelUtils';

/**
 * 智能部署视图（v3.2.2 P0-1 重构）。
 * 由原「DeployPanel 弹窗」改造为持久化视图，与 chat / preview / documents 平等出现在
 * header 主导航里。四大支柱语义保持不变：
 * - 🎯 一键启动（复用 preview server，零门槛）
 * - 🛠️ 智能打包（spawn electron-builder 真打 .exe / .dmg / .AppImage）
 * - 📚 部署指引（云 / Docker / 服务器，给真实命令与产物入口）
 * - ⚙️ 高级导出（5 步 DeployConfigWizard → 真实 zip）
 *
 * 与原 DeployPanel 的差异：
 * - 去掉 fixed inset-0 模态外层：直接作为 <main><section> 的子组件渲染；
 * - 头部不再是「关闭 ✕」，而是「← 返回对话」按钮，把视图切换回 chat；
 * - 顶部标题栏从「弹窗标题」改为「页面级 header」，与其他持久视图风格一致；
 * - 不再订阅 useExportStore.visible（已删除），仅消费导出状态字段（exporting / done / error / zipPath）。
 */

type DeployStage = 'home' | 'quick-start' | 'package' | 'guide' | 'advanced' | 'success';

const PILLARS: { key: DeployStage; icon: string; label: string; tag: string; desc: string }[] = [
  {
    key: 'quick-start',
    icon: '🎯',
    label: '一键启动',
    tag: '推荐 · 零门槛',
    desc: '在 FreeCoder 内直接运行，无需任何导出，立刻看到效果',
  },
  {
    key: 'package',
    icon: '🛠️',
    label: '智能打包',
    tag: '适合分享',
    desc: '自动生成可双击运行的安装包，发给朋友装上就能用',
  },
  {
    key: 'guide',
    icon: '📚',
    label: '部署指引',
    tag: '云端 / Docker',
    desc: '图文 + AI 陪话，手把手教你部署到云端或服务器',
  },
  {
    key: 'advanced',
    icon: '⚙️',
    label: '高级导出',
    tag: '开发者用',
    desc: '导出源码 + Dockerfile + 部署文档，给懂技术的同事接手',
  },
];

function ActiveStagePill({ stage }: { stage: DeployStage }) {
  const meta = PILLARS.find((p) => p.key === stage);
  if (!meta) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-white"
      aria-label={`当前在 ${meta.label}`}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

const GUIDE_TARGETS = [
  { icon: '☁️', label: '一键部署到云', desc: '最简单，3 分钟给你一个公开链接', cta: '开始部署' },
  { icon: '🐳', label: 'Docker 部署', desc: '工程师的选择，需要先装 Docker', cta: '查看指引' },
  { icon: '🖥️', label: '部署到服务器', desc: '适合长期运行，需要一台服务器', cta: '查看指引' },
];

interface PackageState {
  status: 'idle' | 'running' | 'success' | 'failed';
  stage: string;
  message: string;
  /** electron-builder 输出的实时日志（最多保留 80 行避免内存爆炸） */
  logs: string[];
  outputDir?: string;
  artifactName?: string;
  error?: string;
}

const INITIAL_PACKAGE_STATE: PackageState = {
  status: 'idle',
  stage: '',
  message: '',
  logs: [],
};

export default function DeployView() {
  const exporting = useExportStore((s) => s.exporting);
  const exportDone = useExportStore((s) => s.done);
  const exportError = useExportStore((s) => s.error);
  const zipPath = useExportStore((s) => s.zipPath);
  const startExport = useExportStore((s) => s.startExport);
  const setView = useUiStore((s) => s.setView);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projects = useProjectStore((s) => s.projects);
  const projectStatus = useChatStore((s) => s.projectStatus);
  const lastTestReport = useChatStore((s) => s.lastTestReport);
  const autoTestLastSummary = useChatStore((s) => s.autoTestLastSummary);
  const devProgress = useChatStore((s) => s.devProgress);

  // v3.2.2 P0-1 重构：进入视图时回到 home。切换项目时会重新挂载（App.tsx 用 currentProjectId 作 key），
  // 这里仅处理"用户已就绪后再切回 deploy 视图"的场景——避免上次的子面板状态残留。
  const [stage, setStage] = useState<DeployStage>('home');
  const [wizardConfig, setWizardConfig] = useState<DeployConfig>(() => createDefaultDeployConfig());
  const [assistantActive, setAssistantActive] = useState(false);
  const [quickStartBusy, setQuickStartBusy] = useState(false);
  const [quickStartError, setQuickStartError] = useState<string | null>(null);
  const [pkgState, setPkgState] = useState<PackageState>(INITIAL_PACKAGE_STATE);

  // —— 订阅 export:complete / package:progress / package:complete ——
  useEffect(() => {
    const unsubPkgProgress = window.electron.package.onProgress((evt: PackageProgressEvent) => {
      setPkgState((prev) => ({
        ...prev,
        status: 'running',
        stage: evt.stage,
        message: evt.message,
        logs: evt.detail ? [...prev.logs, evt.detail].slice(-80) : prev.logs,
      }));
    });
    const unsubPkgComplete = window.electron.package.onComplete((evt: PackageCompleteEvent) => {
      setPkgState((prev) => ({
        ...prev,
        status: evt.status === 'success' ? 'success' : 'failed',
        ...(evt.outputDir ? { outputDir: evt.outputDir } : {}),
        ...(evt.artifactName ? { artifactName: evt.artifactName } : {}),
        ...(evt.error ? { error: evt.error } : {}),
      }));
    });
    return () => {
      unsubPkgProgress();
      unsubPkgComplete();
    };
  }, []);

  // —— 导出完成后自动切到 success stage（边沿触发：false → true） ——
  const prevExportDoneRef = useRef(false);
  useEffect(() => {
    const justDone = exportDone && !prevExportDoneRef.current;
    prevExportDoneRef.current = exportDone;
    if (justDone && stage !== 'success') {
      setStage('success');
    }
  }, [exportDone, stage]);

  // v0.1.02 P3-5：canDeploy / canQuickStart / canPackage 三个分支保持原语义：
  // - canDeploy：developing / ready / exported 都能进入（draft / planned 拦截）；
  // - canQuickStart / canPackage：只允许 ready / exported（必须先完成自动开发）。
  const canDeploy =
    projectStatus === 'developing' ||
    projectStatus === 'ready' ||
    projectStatus === 'exported';
  const canQuickStart = projectStatus === 'ready' || projectStatus === 'exported';
  const canPackage = projectStatus === 'ready' || projectStatus === 'exported';
  const currentProject = projects.find((p) => p.id === currentProjectId);

  /** 🎯 一键启动：复用 preview server，零门槛跑起来 */
  const handleQuickStart = async () => {
    if (!currentProjectId || quickStartBusy) return;
    setQuickStartBusy(true);
    setQuickStartError(null);
    try {
      const result = await window.electron.preview.start({ projectId: currentProjectId });
      if (result.success) {
        await window.electron.preview.openExternal();
        // 启动后回到 home，让用户继续选别的（不阻塞，UX 更顺）
        setStage('home');
      } else {
        setQuickStartError('启动失败，请稍后再试');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '启动失败';
      setQuickStartError(msg);
    } finally {
      setQuickStartBusy(false);
    }
  };

  /** 🛠️ 智能打包：调 package:start，让 IPC 层负责进度推送 */
  const handleStartPackage = async () => {
    if (!currentProjectId) return;
    setPkgState({ ...INITIAL_PACKAGE_STATE, status: 'running', message: '正在提交打包任务…' });
    try {
      const result = await window.electron.package.start({ projectId: currentProjectId });
      if (!result.success) {
        setPkgState({
          ...INITIAL_PACKAGE_STATE,
          status: 'failed',
          error: result.error ?? '打包启动失败',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '打包启动失败';
      setPkgState({ ...INITIAL_PACKAGE_STATE, status: 'failed', error: msg });
    }
  };

  /** ⚙️ 高级导出第 5 步「🚀 开始导出」的真实出口 */
  const handleAdvancedExport = async () => {
    if (!currentProjectId) return;
    try {
      await startExport(currentProjectId, wizardConfig);
    } catch (err) {
      console.warn('[deploy] startExport 异常', err);
    }
  };

  const revealArtifact = async (path: string) => {
    await window.electron.app.revealInFolder(path);
  };

  /** v3.2.2 P0-1 重构：视图顶部「← 返回对话」按钮的回调。
   *  把视图切回 chat 而不是关闭弹窗——原来「✕ 关闭」消失后，
   *  用户不再需要"弹窗去哪了"的认知负担，但需要一条显式返回路径避免被困。 */
  const handleBackToChat = () => setView('chat');

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* 顶部页面 header（与其他持久视图一致：返回 + 标题 + 当前阶段 pill） */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBackToChat}
            aria-label="返回对话视图"
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50"
          >
            <span aria-hidden="true">←</span>
            返回对话
          </button>
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <span className="text-lg" aria-hidden="true">🚀</span>
              智能部署
              {stage !== 'home' && stage !== 'success' && <ActiveStagePill stage={stage} />}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {stage === 'home'
                ? '选一个最简单的方式，让你的应用跑起来'
                : stage === 'success'
                  ? '项目已完成部署准备'
                  : '可在下方切换到其他方式'}
            </p>
          </div>
        </div>
      </header>

      {/* 内容区：可滚动 */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {/* 未达部署前置条件：给出空态引导，不强行展开 */}
          {!canDeploy && stage === 'home' && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              <div className="mb-1 text-2xl">🛠️</div>
              应用还在开发中，完成后这里会显示部署入口
              <div className="mt-2 text-xs text-slate-400">
                你可以先去预览页看看效果，或继续对话完善需求
              </div>
            </div>
          )}

          {/* Home：四大支柱卡片 */}
          {canDeploy && stage === 'home' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PILLARS.map((p) => {
                const enabled =
                  p.key === 'quick-start'
                    ? canQuickStart
                    : p.key === 'package'
                      ? canPackage
                      : true;
                const disabledHint =
                  !enabled && p.key === 'quick-start'
                    ? '需要先完成自动开发（状态：已就绪）'
                    : !enabled && p.key === 'package'
                      ? '需要先完成自动开发（状态：已就绪）'
                      : null;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => enabled && setStage(p.key)}
                    disabled={!enabled}
                    title={disabledHint ?? undefined}
                    className={`group rounded-xl border bg-white p-4 text-left transition-all ${
                      enabled
                        ? 'border-slate-200 hover:border-brand hover:shadow-sm'
                        : 'cursor-not-allowed border-slate-200 opacity-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl leading-none">{p.icon}</span>
                        <span className="text-sm font-medium text-slate-800">{p.label}</span>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 group-hover:bg-brand/10 group-hover:text-brand">
                        {p.tag}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">{p.desc}</p>
                    {disabledHint && (
                      <p className="mt-1.5 text-[11px] text-slate-400">{disabledHint}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* 一键启动子面板 */}
          {stage === 'quick-start' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
                <div className="font-medium">🎯 我们为你准备好了运行所需的一切</div>
                <div className="mt-1 text-xs text-emerald-600">
                  点击下方按钮，应用将立即在浏览器中打开
                </div>
              </div>
              <button
                type="button"
                onClick={handleQuickStart}
                disabled={!currentProjectId || quickStartBusy}
                className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {quickStartBusy ? '⏳ 正在启动…' : '▶ 立即启动'}
              </button>
              {quickStartError && <p className="text-xs text-red-500">{quickStartError}</p>}
              <button
                type="button"
                onClick={() => setStage('home')}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                返回选择
              </button>
            </div>
          )}

          {/* 智能打包子面板 */}
          {stage === 'package' && (
            <div className="space-y-3">
              {pkgState.status === 'idle' && (
                <>
                  <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
                    <div className="font-medium">🛠️ 正在准备打包环境…</div>
                    <div className="mt-1 text-xs text-amber-600">
                      首次打包需要 5-10 分钟，之后会快很多；产物可双击运行或发给朋友
                    </div>
                  </div>
                  <div className="space-y-1.5 text-xs text-slate-500">
                    <div>✅ 检测系统环境</div>
                    <div className="text-slate-400">○ 准备应用资源…</div>
                    <div className="text-slate-400">○ 生成 Electron 壳工程</div>
                    <div className="text-slate-400">○ 调用 electron-builder</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleStartPackage}
                    disabled={!currentProjectId}
                    className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
                  >
                    🛠️ 开始打包
                  </button>
                  <button
                    type="button"
                    onClick={() => setStage('home')}
                    className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    返回选择
                  </button>
                </>
              )}

              {(pkgState.status === 'running' || pkgState.status === 'success') && (
                <>
                  <div
                    className={`rounded-xl p-4 text-sm ${
                      pkgState.status === 'success'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    <div className="font-medium">
                      {pkgState.status === 'success' ? '🎉 打包完成' : `📦 ${pkgState.stage || '打包中'}`}
                    </div>
                    <div className="mt-1 text-xs opacity-80">{pkgState.message}</div>
                  </div>
                  {pkgState.logs.length > 0 && (
                    <pre className="max-h-40 overflow-y-auto rounded-lg bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-200">
                      {pkgState.logs.slice(-8).join('\n')}
                    </pre>
                  )}
                  {pkgState.status === 'success' && pkgState.outputDir && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void revealArtifact(pkgState.outputDir!)}
                        className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand-hover"
                      >
                        📂 打开产物目录
                      </button>
                      <button
                        type="button"
                        onClick={() => setStage('home')}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        返回首页
                      </button>
                    </div>
                  )}
                  {pkgState.status === 'running' && (
                    <button
                      type="button"
                      onClick={() => setStage('home')}
                      className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      后台运行（返回首页）
                    </button>
                  )}
                </>
              )}

              {pkgState.status === 'failed' && (
                <>
                  <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
                    <div className="font-medium">❌ 打包失败</div>
                    <div className="mt-1 text-xs">{pkgState.error}</div>
                  </div>
                  {pkgState.logs.length > 0 && (
                    <pre className="max-h-40 overflow-y-auto rounded-lg bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-200">
                      {pkgState.logs.slice(-12).join('\n')}
                    </pre>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleStartPackage}
                      className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover"
                    >
                      🔁 重试
                    </button>
                    <button
                      type="button"
                      onClick={() => setStage('home')}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      返回
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 部署指引 */}
          {stage === 'guide' && (
            <div className="space-y-3">
              <div className="space-y-2">
                {GUIDE_TARGETS.map((g) => (
                  <button
                    key={g.label}
                    type="button"
                    onClick={() => setAssistantActive(true)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-brand"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{g.icon}</span>
                      <div>
                        <div className="text-sm font-medium text-slate-800">{g.label}</div>
                        <div className="text-xs text-slate-500">{g.desc}</div>
                      </div>
                    </div>
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {g.cta}
                    </span>
                  </button>
                ))}
              </div>
              {zipPath && (
                <button
                  type="button"
                  onClick={() => void revealArtifact(zipPath)}
                  className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-100"
                >
                  📂 打开已导出的部署包（含 deploy-guide.html）
                </button>
              )}
              <button
                type="button"
                onClick={() => setStage('home')}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                返回选择
              </button>
            </div>
          )}

          {/* 高级导出：DeployConfigWizard + 真实触发 startExport */}
          {stage === 'advanced' && (
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                ⚙️ 开发者选项 · 需要技术背景才能使用
              </div>
              <DeployConfigWizard
                config={wizardConfig}
                onChange={setWizardConfig}
                onFinish={handleAdvancedExport}
                onClose={() => setStage('home')}
              />
              {exporting && (
                <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
                  ⏳ 正在打包项目（含 Dockerfile / docker-compose / 部署指南）…
                </div>
              )}
              {exportError && !exporting && (
                <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
                  ❌ 导出失败：{exportError}
                </div>
              )}
              <button
                type="button"
                onClick={() => setStage('home')}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                返回选择
              </button>
            </div>
          )}

          {/* 兜底成功后展示项目里程碑 */}
          {stage === 'success' && zipPath && (
            <MilestoneCard
              data={{
                projectName: currentProject?.name ?? '当前项目',
                testPassRate: formatTestPassRate(lastTestReport),
                totalDurationMs: autoTestLastSummary?.totalDurationMs,
                fileCount: countFilesFromDevProgress(devProgress) || undefined,
                artifactKind: '部署包（zip / Docker）',
                artifactPath: zipPath,
              }}
              onOpenArtifact={() => void revealArtifact(zipPath)}
              onViewGuide={() => setStage('guide')}
              onShare={() => void revealArtifact(zipPath)}
              onRestart={() => setStage('home')}
            />
          )}
          {stage === 'success' && !zipPath && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
              ⏳ 等待导出结果…如果长时间无响应，请到对话页查看开发日志。
            </div>
          )}
        </div>
      </div>

      {/* AI 部署助手浮层（识别 / 引导 / 兜底三态） */}
      {assistantActive && (
        <DeploymentAssistant
          onClose={() => setAssistantActive(false)}
          onSuccess={() => {
            setAssistantActive(false);
            setStage('success');
          }}
        />
      )}
    </div>
  );
}
