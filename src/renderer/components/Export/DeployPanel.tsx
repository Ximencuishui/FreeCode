import { useEffect, useState } from 'react';
import { useExportStore } from '../../store/export';
import { useProjectStore } from '../../store/project';
import { useChatStore } from '../../store/chat';
import DeployConfigWizard from './DeployConfigWizard';
import { createDefaultDeployConfig } from '@shared/types/export';
import type { DeployConfig } from '@shared/types/export';
import DeploymentAssistant from './DeploymentAssistant';
import MilestoneCard from './MilestoneCard';
import type { PackageCompleteEvent, PackageProgressEvent } from '@shared/types/package';

/**
 * 智能部署面板（v3.2）。
 * PRD 2.3：替代原"导出部署包"，围绕"让应用真正跑起来"重组功能。
 * 四大支柱：
 * - 🎯 一键启动（复用 preview server，零门槛）
 * - 🛠️ 智能打包（spawn electron-builder 真打 .exe / .dmg / .AppImage）
 * - 📚 部署指引（云 / Docker / 服务器，给真实命令与产物入口）
 * - ⚙️ 高级导出（5 步 DeployConfigWizard → 真实 zip）
 *
 * 修复历史（v3.2.1）：
 * - P0：高级导出的"🚀 开始导出"按钮真实触发 exportStore.startExport（不再直接关弹窗）
 * - P1：一键启动按钮接入 preview:start + 用系统浏览器打开
 * - P1：智能打包按钮接入 package:start，订阅进度与完成事件
 * - P2：成功完成后 MilestoneCard 接 zipPath / 产物路径，并 revealInFolder 打开
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

export default function DeployPanel() {
  const visible = useExportStore((s) => s.visible);
  const close = useExportStore((s) => s.close);
  const exporting = useExportStore((s) => s.exporting);
  const exportDone = useExportStore((s) => s.done);
  const exportError = useExportStore((s) => s.error);
  const zipPath = useExportStore((s) => s.zipPath);
  const startExport = useExportStore((s) => s.startExport);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projects = useProjectStore((s) => s.projects);
  const projectStatus = useChatStore((s) => s.projectStatus);
  const lastTestReport = useChatStore((s) => s.lastTestReport);

  // 面板重新打开时回到 home
  const [stage, setStage] = useState<DeployStage>('home');
  // 高级导出子流程保留原 wizard
  const [wizardConfig, setWizardConfig] = useState<DeployConfig>(() => createDefaultDeployConfig());
  // AI 部署助手是否激活（识别/引导/兜底三态由组件内部管理）
  const [assistantActive, setAssistantActive] = useState(false);
  // 一键启动 UI 状态
  const [quickStartBusy, setQuickStartBusy] = useState(false);
  const [quickStartError, setQuickStartError] = useState<string | null>(null);
  // 智能打包状态机
  const [pkgState, setPkgState] = useState<PackageState>(INITIAL_PACKAGE_STATE);

  // —— 订阅 export:complete / package:progress / package:complete ——
  useEffect(() => {
    const unsubExport = window.electron.export.onComplete(() => {
      // App 层已经把结果写入 exportStore；这里通过 useEffect 同步 stage
    });
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
      unsubExport();
      unsubPkgProgress();
      unsubPkgComplete();
    };
  }, []);

  // —— P0 修复：导出完成后自动切到 success stage，让 MilestoneCard 真正展示 ——
  useEffect(() => {
    if (exportDone && stage === 'advanced') {
      setStage('success');
    }
  }, [exportDone, stage]);

  // —— 打开弹窗时重置打包状态机（避免上次残留） ——
  useEffect(() => {
    if (visible) {
      setPkgState(INITIAL_PACKAGE_STATE);
      setQuickStartError(null);
    }
  }, [visible]);

  if (!visible) return null;

  const canDeploy = projectStatus === 'ready' || projectStatus === 'exported';
  const currentProject = projects.find((p) => p.id === currentProjectId);

  /** 🎯 一键启动：复用 preview server，零门槛跑起来 */
  const handleQuickStart = async () => {
    if (!currentProjectId || quickStartBusy) return;
    setQuickStartBusy(true);
    setQuickStartError(null);
    try {
      const result = await window.electron.preview.start({ projectId: currentProjectId });
      if (result.success) {
        // 用系统浏览器打开（与 PreviewContainer "🌐 用浏览器打开" 一致）
        await window.electron.preview.openExternal();
        // 回到 home 让用户继续选别的（不阻塞，UX 更顺）
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
      // 成功后由 onComplete 回调把 status 翻成 success / failed
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
      // 不在这里切 stage：由 useEffect 监听 exportDone 切到 success
    } catch (err) {
      // startExport 内部已写 error；不再二次抛
      console.warn('[deploy] startExport 异常', err);
    }
  };

  /** 打开产物目录（zipPath 或 package outputDir） */
  const revealArtifact = async (path: string) => {
    await window.electron.app.revealInFolder(path);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={close}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <span className="text-lg">🚀</span>
              智能部署
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              选一个最简单的方式，让你的应用跑起来
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-slate-400 hover:text-slate-600"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 未达部署前置条件：给出空态引导，不强行展开 */}
        {!canDeploy && stage === 'home' && (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
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
            {PILLARS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setStage(p.key)}
                className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-brand hover:shadow-sm"
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
              </button>
            ))}
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
            {quickStartError && (
              <p className="text-xs text-red-500">{quickStartError}</p>
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
                    pkgState.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  <div className="font-medium">
                    {pkgState.status === 'success' ? '🎉 打包完成' : `📦 ${pkgState.stage || '打包中'}`}
                  </div>
                  <div className="mt-1 text-xs opacity-80">{pkgState.message}</div>
                </div>
                {/* 实时日志（最近 8 行） */}
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
                    后台运行（关闭面板）
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

        {/* 部署指引：3 个子卡片 + AI 助手钩子 */}
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

        {/* 高级导出：复用原 DeployConfigWizard + 真实触发 startExport */}
        {stage === 'advanced' && (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              ⚙️ 开发者选项 · 需要技术背景才能使用
            </div>
            <DeployConfigWizard
              config={wizardConfig}
              onChange={setWizardConfig}
              onFinish={handleAdvancedExport}
              onClose={close}
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

        {/* 兜底成功后展示项目里程碑（PRD 2.4.6） */}
        {stage === 'success' && zipPath && (
          <MilestoneCard
            data={{
              projectName: currentProject?.name ?? '当前项目',
              testPassRate: lastTestReport
                ? `${lastTestReport.issues.filter((i) => i.severity !== 'high').length} / ${lastTestReport.issues.length}`
                : undefined,
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
    </div>
  );
}