import { useState } from 'react';
import { useProjectStore } from '../store/project';

/** 项目欢迎卡片：无项目时创建新项目（前端设计说明书 4.4 空状态） */
export default function ProjectWelcome() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const createProject = useProjectStore((s) => s.createProject);

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
      setError(result.error ?? '创建失败，请重试');
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
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
  );
}
