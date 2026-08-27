import { useState } from 'react';
import { useProjectStore } from '../store/project';
import { useUiStore } from '../store/ui';
import SaveLocationDialog from './SaveLocationDialog';
import { PROJECT_STATUS_LABEL } from './ProjectSwitcher';

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

  // 同名项目数（用于新建时提示，避免误产生重复项目）
  const trimmedName = name.trim();
  const sameNameCount = trimmedName ? projects.filter((p) => p.name === trimmedName).length : 0;

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
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                      {PROJECT_STATUS_LABEL[p.status] ?? p.status}
                    </span>
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
            <p className="mt-2 text-left text-xs text-amber-600">
              ⚠️ 已有 {sameNameCount} 个同名项目「{trimmedName}」，建议直接打开已有项目；仍要新建将自动命名为「
              {trimmedName}-{sameNameCount + 1}」
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

        {/* 主流程预告：让用户知道接下来会发生什么 */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-y-1 text-xs text-slate-400">
          {['💬 聊需求', '🗺️ 版本分段', '🤖 自动写代码', '🔍 预览调整', '📦 导出使用'].map((s, i) => (
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
