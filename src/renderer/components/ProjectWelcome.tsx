import { useState } from 'react';
import { useProjectStore } from '../store/project';
import { useUiStore } from '../store/ui';

/** 项目欢迎卡片：无项目时创建新项目（前端设计说明书 4.4 空状态） */
export default function ProjectWelcome() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const createProject = useProjectStore((s) => s.createProject);
  const apiKeyConfigured = useUiStore((s) => s.apiKeyConfigured);
  const openSettings = useUiStore((s) => s.openSettings);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入项目名称');
      return;
    }
    setCreating(true);
    setError('');
    const result = await createProject(trimmed);
    if (!result.success) {
      // 运行时 error 可能是 FreeCoderError 对象（类型标注为 string，属历史类型缺口）
      const raw = result.error as unknown;
      const message =
        typeof raw === 'string'
          ? raw
          : raw && typeof raw === 'object' && 'message' in raw
            ? String((raw as { message: unknown }).message)
            : '创建失败，请重试';
      setError(message);
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
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
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-lg font-medium text-slate-700">✨ 开始一个新想法</p>
          <p className="mt-2 text-sm text-slate-500">
            您还没有创建任何项目。给您的第一个作品起个名字吧：
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            placeholder="例如：我的记账本"
            className="mt-5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand"
          />
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          <button
            type="button"
            disabled={creating || name.trim().length === 0}
            onClick={() => void handleCreate()}
            className="mt-4 w-full rounded-lg bg-brand py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? '创建中…' : '开始对话'}
          </button>
        </div>
      </div>
    </div>
  );
}
