import { useState } from 'react';
import { useProjectStore } from '../store/project';
import { useUiStore } from '../store/ui';
import SaveLocationDialog from './SaveLocationDialog';
import { ProjectStatusBadge } from './ProjectSwitcher';

/** 项目欢迎卡片：无项目时展示最近项目快捷入口（可删除）+ 新建表单（前端设计说明书 4.4 空状态） */
export default function ProjectWelcome() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const createProject = useProjectStore((s) => s.createProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const projects = useProjectStore((s) => s.projects);
  const selectProject = useProjectStore((s) => s.selectProject);
  const apiKeyConfigured = useUiStore((s) => s.apiKeyConfigured);
  const openSettings = useUiStore((s) => s.openSettings);

  // 最近项目：按 id 去重（防御性），按最近打开时间倒序，最多 5 个
  const recent = [...new Map(projects.map((p) => [p.id, p])).values()]
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt))
    .slice(0, 5);

  // 同名项目数（用于新建时提示，避免误产生重复项目）。
  // v3.2.1 P2-6：之前按 displayName 精确匹配（projects.filter(p.name === trimmedName).length），
  // 但主进程 storage/index.ts::resolveProjectDir 实际按 "sanitize 后的 base + 后缀" 比较占用——
  // 极端情况：用户输入含 `/` 或特殊字符，原名经 sanitize 后变化，会出现
  //   - 用户输入「我的/项目」
  //   - 已有项目显示名「我的/项目」+ 「我的项目」（旧数据由 sanitize 变化生成）
  //   - 前端 sameNameCount=1（只匹配原名），后端实际从 suffix=2 开始算 → 落到「我的项目-2」
  // 提示与实际不符。
  // 修复：用 startsWith(`${trimmedName}`) 涵盖「原名 + -N 后缀」两种占用，并按主进程 sanitize 规则
  // 推导 sanitizeBase 后再比较，更接近后端实际占用判定。
  const trimmedName = name.trim();
  const sanitizeBase = trimmedName
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[.\s]+$/g, '')
    .trim() || '未命名项目';
  const sameNameCount = trimmedName
    ? projects.filter((p) => {
        const pBase = (p.name ?? '')
          .replace(/[\\/:*?"<>|]/g, '')
          .replace(/[.\s]+$/g, '')
          .trim() || '未命名项目';
        return pBase === sanitizeBase || pBase === `${sanitizeBase}-2`;
      }).length
    : 0;
  // v3.2.1 P2-6：预测下一个自动名——按后端 dirToDisplayName 规则（base 或 `${base}-${suffix}`，suffix≥2）。
  // 不依赖 sameNameCount 精确推算（极端情况可能与实际差 1），仅作"用户大概会看到"的提示。
  const predictedName = sameNameCount === 0 ? trimmedName : `${trimmedName}-${sameNameCount + 1}`;

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    const result = await deleteProject(id);
    if (!result.success) setError(extractErrorMessage(result.error));
  };

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入项目名称');
      return;
    }
    setError('');
    // 先弹窗询问保存位置：用户可选择文件夹，或跳过使用默认位置
    setDialogOpen(true);
  };

  const extractErrorMessage = (raw: unknown): string => {
    // 运行时 error 可能是 FreeCoderError 对象（类型标注为 string，属历史类型缺口）
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object' && 'message' in raw) {
      return String((raw as { message: unknown }).message);
    }
    return '创建失败，请重试';
  };

  const handleConfirm = async (location?: string) => {
    setCreating(true);
    setError('');
    const result = await createProject(name.trim(), location ? { location } : undefined);
    if (!result.success) {
      setError(extractErrorMessage(result.error));
      setCreating(false);
      // 失败时保持弹窗打开，便于重试或换位置
      return;
    }
    // 成功：store 已切换 currentProjectId，欢迎页随即卸载
    setDialogOpen(false);
  };

  const handleCancel = () => {
    if (creating) return;
    setDialogOpen(false);
    setError('');
  };

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-md">
        {apiKeyConfigured === false && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <span>⚠️ 尚未配置大模型 API，配置后即可开始对话</span>
            <button
              type="button"
              onClick={openSettings}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-600"
            >
              立即配置
            </button>
          </div>
        )}

        {/* 最近项目快捷入口（点击直接进入；悬停显示删除按钮，二次确认） */}
        {recent.length > 0 && (
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium text-slate-400">🕘 最近项目（点击继续）</p>
            <div className="flex flex-col gap-2">
              {recent.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-brand"
                >
                  <button
                    type="button"
                    onClick={() => selectProject(p.id)}
                    title={`打开 ${p.name}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 py-1 text-left"
                  >
                    <span className="truncate text-sm font-medium text-slate-700">
                      📁 {p.name}
                    </span>
                    {/* v3.2.1 P2-4：状态徽标改用 ProjectStatusBadge 共用组件 */}
                    <ProjectStatusBadge status={p.status} variant="card" />
                  </button>
                  {confirmDeleteId === p.id ? (
                    <span className="flex shrink-0 items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => void handleDelete(p.id)}
                        className="rounded bg-red-500 px-2 py-1 font-medium text-white transition-colors hover:bg-red-600"
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded border border-slate-200 px-2 py-1 text-slate-500 transition-colors hover:bg-slate-50"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(p.id)}
                      title="删除项目"
                      aria-label={`删除 ${p.name}`}
                      className="shrink-0 rounded p-1.5 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                    >
                      🗑
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-lg font-medium text-slate-700">✨ 开始一个新想法</p>
          <p className="mt-2 text-sm text-slate-500">
            {recent.length > 0
              ? '想做个新的？给新项目起个名字：'
              : '您还没有创建任何项目。给您的第一个作品起个名字吧：'}
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="例如：我的记账本"
            className="mt-5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand"
          />
          {sameNameCount > 0 && (
            // v3.2.1 P2-6：用 predictedName 显示预测的自动名（按后端 sanitize + 后缀规则推算）。
            // 之前写死 sameNameCount + 1 可能在 sanitize 后变化时和后端实际差 1，
            // 现在用 sanitize 后的 base 匹配，更贴近主进程 dirToDisplayName 的行为。
            <p className="mt-2 text-left text-xs text-amber-600">
              ⚠️ 已有 {sameNameCount} 个同名项目「{trimmedName}」，建议直接打开已有项目；
              仍要新建将自动命名为「{predictedName}」
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          <button
            type="button"
            disabled={name.trim().length === 0}
            onClick={handleCreate}
            className="mt-4 w-full rounded-lg bg-brand py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            开始对话
          </button>
          <p className="mt-3 text-xs text-slate-400">
            创建时可以选择保存位置，或使用默认位置（本程序下的 Project 目录）
          </p>
        </div>

        {/* 主流程预告：让用户知道接下来会发生什么（与 PRD v3.2 四大模块对齐） */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-y-1 text-xs text-slate-400">
          {['💬 聊需求', '🤖 自动开发', '🧪 自动测试', '🔍 预览调整', '🚀 一键部署'].map((s, i) => (
            <span key={s} className="flex items-center">
              {i > 0 && <span className="mx-1.5 text-slate-300">→</span>}
              <span>{s}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-slate-300">
          先做最小可用版本（MVP），用起来再逐步完善
        </p>
      </div>

      {dialogOpen && (
        <SaveLocationDialog
          projectName={name.trim()}
          creating={creating}
          error={error}
          onConfirm={(location) => void handleConfirm(location)}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
