import { useState } from 'react';
import { useExportStore } from '../../store/export';
import { useProjectStore } from '../../store/project';
import { useChatStore } from '../../store/chat';
import DeployConfigWizard from './DeployConfigWizard';
import { createDefaultDeployConfig } from '@shared/types/export';
import type { DeployConfig } from '@shared/types/export';
import DeploymentAssistant from './DeploymentAssistant';
import MilestoneCard from './MilestoneCard';

/**
 * 智能部署面板（v3.2）。
 * PRD 2.3：替代原"导出部署包"，围绕"让应用真正跑起来"重组功能。
 * 四大支柱：
 * - 🎯 一键启动（在 FreeCoder 内直接运行）
 * - 🛠️ 智能打包（自动生成可双击的 .exe / .dmg）
 * - 📚 部署指引（云 / Docker / 服务器，AI 陪话）
 * - ⚙️ 高级导出（保留 DeployConfigWizard，给开发者用）
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

export default function DeployPanel() {
  const visible = useExportStore((s) => s.visible);
  const close = useExportStore((s) => s.close);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projectStatus = useChatStore((s) => s.projectStatus);

  // 面板重新打开时回到 home
  const [stage, setStage] = useState<DeployStage>('home');
  // 高级导出子流程保留原 wizard
  const [wizardConfig, setWizardConfig] = useState<DeployConfig>(() => createDefaultDeployConfig());
  // AI 部署助手是否激活（识别/引导/兜底三态由组件内部管理）
  const [assistantActive, setAssistantActive] = useState(false);

  if (!visible) return null;

  const canDeploy = projectStatus === 'ready' || projectStatus === 'exported';

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

        {/* 一键启动子面板（占位，真实启动需接入 dev server） */}
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
              disabled={!currentProjectId}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
              ▶ 立即启动
            </button>
            <button
              type="button"
              onClick={() => setStage('home')}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              返回选择
            </button>
          </div>
        )}

        {/* 智能打包子面板（占位，真实打包需接入主进程 + electron-builder） */}
        {stage === 'package' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
              <div className="font-medium">🛠️ 正在准备打包环境…</div>
              <div className="mt-1 text-xs text-amber-600">
                首次打包需要 2-3 分钟，之后会快很多
              </div>
            </div>
            <div className="space-y-1.5 text-xs text-slate-500">
              <div>✅ 检测系统环境</div>
              <div className="text-slate-400">⏳ 准备应用资源…</div>
              <div className="text-slate-400">○ 编译主程序</div>
              <div className="text-slate-400">○ 打包成可执行文件</div>
            </div>
            <button
              type="button"
              onClick={() => setStage('home')}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              返回选择
            </button>
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
            <button
              type="button"
              onClick={() => setStage('home')}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              返回选择
            </button>
          </div>
        )}

        {/* 高级导出：复用原 DeployConfigWizard */}
        {stage === 'advanced' && (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              ⚙️ 开发者选项 · 需要技术背景才能使用
            </div>
            <DeployConfigWizard
              config={wizardConfig}
              onChange={setWizardConfig}
              onFinish={() => setStage('home')}
              onClose={close}
            />
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
        {stage === 'success' && (
          <MilestoneCard
            data={{
              projectName: '当前项目',
              testPassRate: '15 / 15',
              artifactKind: '一键启动',
              artifactPath: 'http://localhost:5173',
            }}
            onViewGuide={() => setStage('guide')}
            onRestart={() => setStage('home')}
          />
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

        {/* 项目里程碑（部署成功后由父组件渲染；此处保留占位钩子） */}
        {/* 实际里程碑由 Chat 流中的 MilestoneCard 负责渲染，避免在弹窗内堆叠 */}
      </div>
    </div>
  );
}