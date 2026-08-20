import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../store/ui';
import Logo from './Logo';
import type { LlmProviderKind } from '@shared/types/settings';

/**
 * API Key 配置弹窗（首次启动引导，与 DeepSeek Harness 的首启体验一致）：
 * 邀请用户添加大模型 API Key，本地 safeStorage 加密存储，不上传任何服务。
 * 同时支持 DeepSeek 官方与 OpenAI 兼容自定义接口（WP-08 联调时写入 DSH 配置）。
 */

const PROVIDERS: { key: LlmProviderKind; label: string; desc: string }[] = [
  { key: 'deepseek', label: 'DeepSeek 官方', desc: 'https://api.deepseek.com' },
  { key: 'openai-compatible', label: '自定义接口', desc: 'OpenAI 兼容 Base URL' },
];

const DEFAULT_BASE_URLS: Record<LlmProviderKind, string> = {
  deepseek: 'https://api.deepseek.com',
  'openai-compatible': 'https://api.deepseek.com',
};

const DEFAULT_MODELS: Record<LlmProviderKind, string> = {
  deepseek: 'deepseek-chat',
  'openai-compatible': 'deepseek-chat',
};

interface ApiKeyModalProps {
  /** 保存成功回调（用于父组件刷新设置，保证下次打开回显最新配置） */
  onSaved?: () => void;
  initialProvider?: LlmProviderKind;
  initialBaseUrl?: string;
  initialModel?: string;
}

export default function ApiKeyModal({
  onSaved,
  initialProvider,
  initialBaseUrl,
  initialModel,
}: ApiKeyModalProps) {
  const open = useUiStore((s) => s.settingsOpen);
  const inviteMode = useUiStore((s) => s.inviteMode);
  const closeSettings = useUiStore((s) => s.closeSettings);
  const setApiKeyConfigured = useUiStore((s) => s.setApiKeyConfigured);

  const [provider, setProvider] = useState<LlmProviderKind>(
    initialProvider === 'openai-compatible' ? 'openai-compatible' : 'deepseek',
  );
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [wasInvite, setWasInvite] = useState(inviteMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const prevOpenRef = useRef(false);

  // 仅在弹窗由关闭→打开时预填一次（保存成功后的 props 刷新不重跑，避免打断"已保存"状态）
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return;
    const p: LlmProviderKind =
      initialProvider === 'openai-compatible' ? 'openai-compatible' : 'deepseek';
    setProvider(p);
    setBaseUrl(initialBaseUrl?.trim() || DEFAULT_BASE_URLS[p]);
    setModel(initialModel?.trim() || DEFAULT_MODELS[p]);
    setApiKey('');
    setError('');
    setSaving(false);
    setSaved(false);
    setShowAdvanced(false);
    setWasInvite(inviteMode);
    // 弹窗打开后聚焦输入框
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 卸载/关闭时清理延迟关闭定时器
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Esc 关闭（等同"稍后再说"，closeSettings 会清除欢迎态）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, closeSettings]);

  const switchProvider = (next: LlmProviderKind) => {
    setProvider(next);
    setBaseUrl(DEFAULT_BASE_URLS[next]);
    setModel(DEFAULT_MODELS[next]);
    setError('');
  };

  /** 从 IPC 结果中提取可展示的错误文案（error 可能是 FreeCoderError 对象） */
  const errorText = (result: { error?: unknown }): string => {
    if (!result.error) return '操作失败，请重试';
    if (typeof result.error === 'string') return result.error;
    const obj = result.error as { message?: unknown };
    return typeof obj.message === 'string' ? obj.message : '操作失败，请重试';
  };

  const handleSave = async () => {
    if (saving || saved) return;
    const key = apiKey.trim();
    if (!key) {
      setError('请输入 API Key');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await window.electron.apikey.save({
        key,
        provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      });
      if (result.success) {
        setSaved(true);
        setApiKeyConfigured(true);
        onSaved?.();
        if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = window.setTimeout(() => {
          closeSettings();
          closeTimerRef.current = null;
        }, 700);
      } else {
        setError(errorText(result));
        setSaving(false);
      }
    } catch {
      setError('保存失败，请重试');
      setSaving(false);
    }
  };

  const openKeyPage = () => {
    void window.electron.app.openExternal('https://platform.deepseek.com/api_keys');
  };

  const dismiss = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closeSettings();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="配置大模型 API Key"
      onMouseDown={(e) => {
        // 点击遮罩关闭
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* 头部 */}
        <div className="border-b border-slate-100 bg-gradient-to-br from-brand/5 to-transparent px-7 pb-5 pt-7">
          <div className="flex items-center gap-3">
            <Logo size={44} />
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                {wasInvite ? '欢迎使用 FreeCoder' : '大模型 API 设置'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {wasInvite
                  ? '开始之前，请先添加你的大模型 API Key'
                  : '修改大模型提供商与 API Key'}
              </p>
            </div>
          </div>
        </div>

        <div className="px-7 py-5">
          {/* 提供商选择 */}
          <p className="mb-2 text-xs font-medium text-slate-600">模型提供商</p>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => switchProvider(p.key)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  provider === p.key
                    ? 'border-brand bg-brand/5'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className={`block text-sm font-medium ${provider === p.key ? 'text-brand' : 'text-slate-700'}`}>
                  {p.label}
                  {p.key === 'deepseek' && (
                    <span className="ml-1 rounded bg-brand/10 px-1 py-0.5 text-[10px] font-normal text-brand">
                      推荐
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">{p.desc}</span>
              </button>
            ))}
          </div>

          {/* API Key 输入 */}
          <p className="mb-2 mt-5 text-xs font-medium text-slate-600">API Key</p>
          <div className="relative">
            <input
              ref={inputRef}
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
              }}
              placeholder={provider === 'deepseek' ? 'sk-…' : '粘贴你的 API Key'}
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm outline-none transition-colors focus:border-brand"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:text-slate-600"
              title={showKey ? '隐藏' : '显示'}
            >
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
          <button
            type="button"
            onClick={openKeyPage}
            className="mt-1.5 text-xs text-brand hover:underline"
          >
            如何获取 DeepSeek API Key？
          </button>

          {/* 高级选项：Base URL / 模型（自定义接口时默认展开） */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="mt-3 flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700"
          >
            <span
              className={`inline-block transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
            >
              ▶
            </span>
            高级选项（Base URL / 模型）
          </button>
          {showAdvanced && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-[11px] text-slate-500">Base URL</p>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.deepseek.com"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand"
                />
              </div>
              <div>
                <p className="mb-1 text-[11px] text-slate-500">模型名</p>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="deepseek-chat"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand"
                />
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
          {saved && <p className="mt-3 text-xs text-emerald-600">✓ API Key 已保存，即将开始…</p>}

          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              disabled={saving || saved}
              onClick={() => void handleSave()}
              className="flex-1 rounded-lg bg-brand py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? '保存中…' : saved ? '已保存 ✓' : '保存并开始'}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-500 transition-colors hover:bg-slate-50"
            >
              稍后再说
            </button>
          </div>
        </div>

        <p className="border-t border-slate-100 bg-slate-50 px-7 py-3 text-center text-[11px] text-slate-400">
          🔒 API Key 仅保存在本地（系统级加密），不会上传到任何服务器
        </p>
      </div>
    </div>
  );
}
