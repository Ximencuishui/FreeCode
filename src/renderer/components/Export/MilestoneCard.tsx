/**
 * 项目里程碑庆祝卡（v3.2，PRD 2.4.6）。
 * 部署完成后在聊天流顶部常驻 24 小时，强化"对话 → 开发 → 测试 → 部署"闭环成就感。
 *
 * 数据通过 props 传入，不直接读 store，便于复用（DeployView 完成态、Chat 流顶部、
  自动恢复项目等场景都能渲染）。
 */
export interface MilestoneData {
  /** 项目名 */
  projectName: string;
  /** 总耗时（毫秒） */
  totalDurationMs?: number;
  /** 代码文件数 */
  fileCount?: number;
  /** 测试通过率文本，如 "15 / 15" */
  testPassRate?: string;
  /** 产物路径（可空，未打包时仅展示一键启动） */
  artifactPath?: string;
  /** 产物类型描述：dmg / exe / docker / dev-url */
  artifactKind?: string;
}

interface MilestoneCardProps {
  data: MilestoneData;
  onOpenArtifact?: () => void;
  onViewGuide?: () => void;
  onShare?: () => void;
  onRestart?: () => void;
}

const PHASES = [
  { icon: '✅', label: '需求分析' },
  { icon: '✅', label: '开发' },
  { icon: '✅', label: '测试' },
  { icon: '✅', label: '部署' },
];

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min} 分${sec > 0 ? ` ${sec} 秒` : ''}`;
}

export default function MilestoneCard({
  data,
  onOpenArtifact,
  onViewGuide,
  onShare,
  onRestart,
}: MilestoneCardProps) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <span className="text-2xl">🎉</span>
        <span className="text-sm font-semibold text-slate-800">恭喜！项目已完成</span>
      </div>

      {/* 流程徽章 */}
      <div className="mt-3 flex items-center justify-between rounded-xl bg-white/60 p-2">
        {PHASES.map((p, i) => (
          <div key={p.label} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-base leading-none">{p.icon}</span>
              <span className="text-[10px] text-slate-600">{p.label}</span>
            </div>
            {i < PHASES.length - 1 && <span className="mx-1 h-px flex-1 bg-slate-200" />}
          </div>
        ))}
      </div>

      {/* 数据摘要 */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {data.totalDurationMs !== undefined && (
          <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
            <div className="text-[10px] text-slate-400">总计耗时</div>
            <div className="font-medium text-slate-700">
              {formatDuration(data.totalDurationMs)}
            </div>
          </div>
        )}
        {data.fileCount !== undefined && (
          <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
            <div className="text-[10px] text-slate-400">代码文件</div>
            <div className="font-medium text-slate-700">{data.fileCount} 个</div>
          </div>
        )}
        {data.testPassRate && (
          <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
            <div className="text-[10px] text-slate-400">测试通过</div>
            <div className="font-medium text-slate-700">{data.testPassRate}</div>
          </div>
        )}
        {data.artifactPath && (
          <div className="col-span-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <div className="text-[10px] text-slate-400">
              产物{data.artifactKind ? `（${data.artifactKind}）` : ''}
            </div>
            <div className="truncate font-mono text-[11px] text-slate-700">
              {data.artifactPath}
            </div>
          </div>
        )}
      </div>

      {/* 操作按钮（按可用性裁剪） */}
      <div className="mt-3 flex flex-wrap gap-2">
        {data.artifactPath && onOpenArtifact && (
          <button
            type="button"
            onClick={onOpenArtifact}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
          >
            📂 打开产物
          </button>
        )}
        {onViewGuide && (
          <button
            type="button"
            onClick={onViewGuide}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            📖 查看部署指引
          </button>
        )}
        {onShare && (
          <button
            type="button"
            onClick={onShare}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            📤 分享给朋友
          </button>
        )}
        {onRestart && (
          <button
            type="button"
            onClick={onRestart}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            🔁 重新部署
          </button>
        )}
      </div>
    </div>
  );
}