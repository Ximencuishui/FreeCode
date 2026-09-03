import { useCallback } from 'react';
import type { ProjectStatus } from '@shared/types/project';

interface StepFlowProps {
  status: ProjectStatus | null;
  onGoChat: () => void;
  onGoPreview: () => void;
  /** 切到顶部 🚀 部署 Tab（仅在「预览调整」步骤时展示引导按钮）。 */
  onGoDeploy: () => void;
}

/** 主流程步骤条：创建项目 → 方案探讨 → 版本分段 → 生成代码 → 预览调整
 * 「部署」是顶部 header 中间 Tab 的持久化视图，不属于流程阶段本身。
 * 但当「预览调整」是当前激活步骤时，会在末尾追加「→ 🚀 项目部署」引导按钮，
 * 强化"预览 → 上线"的产品闭环提示——避免用户以为流程到"预览调整"就结束了。
 * （原"导出"已挪到顶部 Tab，保留这条注释是为了不在重构里丢失历史决策。）
 */
const STEPS = [
  { key: 'create', label: '创建项目' },
  { key: 'discuss', label: '方案探讨' },
  { key: 'plan', label: '版本分段' },
  { key: 'code', label: '生成代码' },
  { key: 'preview', label: '预览调整' },
] as const;

/** 各状态对应的当前步骤下标（draft=方案探讨，planned=版本分段，developing=生成代码…）。
 * 导出完成后保持在"预览调整"步骤（导出是动作而非流程阶段）。
 *
 * v0.1.02 P2-1：status 为 null 时（理论上不应该发生，但项目初始化瞬间 / 异步加载中短暂存在）
 * 不再回到 0 把"创建项目"标蓝，避免用户感觉"我才刚创建项目就要从 0 开始"。
 * 实际语义：null 视为还没拉取到元数据，最安全的回退是停在「方案探讨」与 draft 一致。 */
function currentIndex(status: ProjectStatus | null): number {
  switch (status) {
    case 'draft':
    case null:
    case undefined:
      return 1;
    case 'planned':
      return 2;
    case 'developing':
      return 3;
    case 'ready':
    case 'exported':
      return 4;
    default:
      return 1;
  }
}

export default function StepFlow({ status, onGoChat, onGoPreview, onGoDeploy }: StepFlowProps) {
  const active = currentIndex(status);

  const handleClick = (index: number) => {
    // 步骤 0-3（创建/探讨/分段/写代码）都在对话中完成；4 去预览
    if (index <= 3) onGoChat();
    else onGoPreview();
  };

  // v0.1.02 P3-1：键盘快捷键——按数字 1-5 直接跳到对应步骤（与鼠标点击同效）。
  // 用 onKeyDown 监听整个步骤条容器，preventDefault 避免页面默认行为（如 5 触发浏览器快速拨号）。
  // handleClick 只用到 onGoChat/onGoPreview，把逻辑内联避免 useCallback 闭包陷阱 + lint 警告
  // （handleClick 每渲染重建，依赖里填它会一直重建 callback）。
  // v0.1.02 P3-AUDIT：步骤条容器里只有 <button> 和 <span>，不会有 INPUT/TEXTAREA/contenteditable。
  // input 标签只渲染在 DraggableChat / RequirementCard 这种兄弟节点里，键盘事件不会横向冒泡到本容器。
  // 兜底检查保留（防御性 + 未来扩展），但用 isContentEditable + tagName 一次性判断。
  const onContainerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key >= '1' && e.key <= '5') {
        const idx = Number(e.key) - 1;
        if (idx >= 0 && idx < STEPS.length) {
          e.preventDefault();
          if (idx <= 3) onGoChat();
          else onGoPreview();
        }
      }
    },
    [onGoChat, onGoPreview],
  );

  return (
    <div
      className="flex shrink-0 items-center justify-center gap-1 border-b border-slate-200 bg-slate-50/60 px-4 py-2"
      // v0.1.02 P3-1：把步骤条标记为可导航工具栏，并捕获数字键
      role="toolbar"
      aria-label="项目流程步骤"
      // v3.2.1 P1-1：把快捷键显式标注出来，让屏幕阅读器与用户都能看到「按数字 1-5 跳转」
      aria-keyshortcuts="1 2 3 4 5"
      tabIndex={0}
      onKeyDown={onContainerKeyDown}
    >
      <p className="mr-2 hidden text-[10px] text-slate-400 lg:block" aria-hidden="true">
        按数字键 1-5 跳转
      </p>
      {STEPS.map((step, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <div key={step.key} className="flex items-center">
            {i > 0 && (
              <span
                className={`mx-1.5 h-px w-6 ${done || current ? 'bg-brand' : 'bg-slate-200'}`}
              />
            )}
            <button
              type="button"
              onClick={() => handleClick(i)}
              // v3.2.1 P2-7：已完成步骤点击等于"回到此步骤"——本身就是回看入口，但之前
              // title 仅写步骤名 + 数字快捷键，用户不知道"已完成步骤也能点"。
              // 这里追加 `已完成 · 点击回看` 提示，让用户清楚语义。
              title={
                done
                  ? `${step.label} · 已完成 · 点击回看（按数字 ${i + 1} 跳转）`
                  : `${step.label}（按数字 ${i + 1} 跳转）`
              }
              aria-label={
                done
                  ? `${step.label}，已完成，点击回看`
                  : step.label
              }
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
                current
                  ? 'bg-brand/10 font-medium text-brand'
                  : done
                    ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                    : 'text-slate-400'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  current
                    ? 'bg-brand text-white'
                    : done
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'bg-slate-200 text-slate-400'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              {step.label}
              {/* v3.2.1 P2-7：已完成步骤右侧追加"↩ 回看"小图标，让"点击回看"语义可视化。 */}
              {done && (
                <span
                  aria-hidden="true"
                  className="text-[10px] text-slate-400 transition-colors group-hover:text-slate-600"
                >
                  ↩
                </span>
              )}
            </button>
          </div>
        );
      })}
      {/* 「下一步：项目部署」引导按钮：
          仅当「预览调整」是当前激活步骤（active === STEPS.length - 1）时渲染，
          强化"预览 → 上线"的产品闭环提示。点击切换到顶部 🚀 部署 Tab，
          与 STEPS 步骤胶囊（灰 / 淡蓝）做视觉区分，用品牌色实心按钮引导用户继续。
          不进 STEPS 数组（部署不属于流程阶段），也不加数字快捷键（保持 1-5 不变）。 */}
      {active === STEPS.length - 1 && (
        <>
          <span className="mx-1.5 text-slate-300" aria-hidden="true">
            →
          </span>
          <button
            type="button"
            onClick={onGoDeploy}
            title="下一步：项目部署（顶部 🚀 部署 Tab）"
            aria-label="下一步：项目部署"
            className="flex items-center gap-1.5 rounded-full bg-brand px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-brand-hover"
          >
            <span aria-hidden="true">🚀</span>
            项目部署
          </button>
        </>
      )}
    </div>
  );
}
