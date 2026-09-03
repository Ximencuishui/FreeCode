import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../store/ui';
import Logo from './Logo';
import type { LlmProviderKind } from '@shared/types/settings';

/**
 * API Key 配置弹窗（首次启动引导，与 DeepSeek Harness 的首启体验一致）：
 * 邀请用户添加大模型 API Key，本地 safeStorage 加密存储，不上传任何服务。
 * 同时支持 DeepSeek 官方与 OpenAI 兼容自定义接口（WP-08 联调时写入 DSH 配置）。
 *
 * v3.2.1 P2-16：改用原生 <dialog> 元素——浏览器自带 focus trap、ESC 关闭、backdrop、
 * inert 行为，无需手写。比 div + role="dialog" 更鲁棒，可访问性更好。
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
  deepseek: 'deepseek-v4-flash',
  'openai-compatible': 'deepseek-v4-flash',
};

interface ApiKeyModalProps {
  /** 保存成功回调（用于父组件刷新设置，保证下次打开回显最新配置） */
  onSaved?: () => void;
  initialProvider?: LlmProviderKind;
  initialBaseUrl?: string;
  initialModel?: string;
  /** 已配置 Key 的脱敏展示（sk-****abcd）；存在表示已接入过大模型 */
  initialApiKeyMasked?: string;
}

export default function ApiKeyModal({
  onSaved,
  initialProvider,
  initialBaseUrl,
  initialModel,
  initialApiKeyMasked,
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
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [wasInvite, setWasInvite] = useState(inviteMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const prevOpenRef = useRef(false);
  // v3.2.1 P2-16：原生 <dialog> 的 ref，用于 showModal()/close()
  const dialogRef = useRef<HTMLDialogElement>(null);

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
    setTesting(false);
    setTestMsg(null);
    // v3.2.1 P1-10：默认折叠高级选项——之前已配置 Key 的用户每次开弹窗都直接看到 Base URL，
    // 容易误以为要改 URL。现在用"已配置 key 时折叠但显示一行提示"，让用户主动点开才展开。
    setShowAdvanced(false);
    setWasInvite(inviteMode);
    // v3.2.1 P2-16：用原生 <dialog> 替代 div：showModal() 自带 backdrop + focus trap + ESC 关闭。
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // 浏览器不支持 showModal 时降级：保持 div 渲染（already-open=false 会让外面 div 渲染）
      }
    }
    // 弹窗打开后聚焦输入框
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // v3.2.1 P2-16：open 从 true → false 时主动 close() <dialog>，避免 backdrop 残留。
  useEffect(() => {
    if (open) return;
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
  }, [open]);

  // 卸载/关闭时清理延迟关闭定时器
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  // v3.2.1 P2-16：原生 <dialog> 自带 ESC 关闭，但仍保留显式监听以触发 store.closeSettings()。
  // showModal() 触发的 ESC 默认只 close dialog，不会清 store。
  // 通过监听 dialog 的 cancel / close 事件来同步 store。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      // 阻止默认 close（我们走 dismiss() 流程清理 store 状态）
      e.preventDefault();
      closeSettings();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [closeSettings]);

  const switchProvider = (next: LlmProviderKind) => {
    setProvider(next);
    setBaseUrl(DEFAULT_BASE_URLS[next]);
    setModel(DEFAULT_MODELS[next]);
    setError('');
    setTestMsg(null);
    setTesting(false);
  };

  /** 从 IPC 结果中提取可展示的错误文案（error 可能是 FreeCoderError 对象） */
  const errorText = (result: { error?: unknown }): string => {
    if (!result.error) return '操作失败，请重试';
    if (typeof result.error === 'string') return result.error;
    const obj = result.error as { message?: unknown };
    return typeof obj.message === 'string' ? obj.message : '操作失败，请重试';
  };

  const handleSave = async () => {
    if (saving || saved || testing) return;
    const key = apiKey.trim();
    const hasExisting = Boolean(initialApiKeyMasked);
    if (!key && !hasExisting) {
      setError('请输入 API Key');
      return;
    }
    const params = { key, provider, baseUrl: baseUrl.trim(), model: model.trim() };

    // 1. 输入了新 Key：非首启模式先做真实连接测试（调端点 /models 校验，通过后才允许保存）
    //    首启模式（wasInvite）跳过连接测试，让用户直接保存进入主流程（测试场景/试用场景友好）
    if (key && !wasInvite) {
      setTesting(true);
      setError('');
      setTestMsg(null);
      try {
        const test = await window.electron.apikey.test(params);
        if (!test.success) {
          setError(test.message || '连接测试失败：API Key 无效或网络不可达');
          setTesting(false);
          return;
        }
        const latency = typeof test.latencyMs === 'number' ? `（${test.latencyMs}ms）` : '';
        const modelCount =
          Array.isArray(test.models) && test.models.length > 0
            ? `，可用模型 ${test.models.length} 个`
            : '';
        setTestMsg({ ok: true, text: `✓ 连接成功${latency}${modelCount}` });
      } catch {
        setError('连接测试失败，请重试');
        setTesting(false);
        return;
      }
      setTesting(false);
    }

    // 2. 保存：有新 Key 则更新 Key；未输入新 Key 则仅保存提供商/Base URL/模型（主进程保留原 Key）
    setSaving(true);
    try {
      const result = await window.electron.apikey.save(params);
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

  // v3.2.1 P2-16：用 <dialog> 渲染。open=false 时不渲染（避免 backdrop 残留）。
  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      // v3.2.1 P2-16：原生 <dialog> 自带 ::backdrop + focus trap，这里只补一个 click outside 关闭。
      // formMethod="dialog" 让表单内 button[formmethod=dialog] 触发 cancel 事件。
      className="w-full max-w-md overflow-hidden rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/40"
      aria-label="配置大模型 API Key"
      onClick={(e) => {
        // 点击 dialog 自身（而不是内部内容）时关闭——等价于点 backdrop。
        if (e.target === e.currentTarget) dismiss();
      }}
    >
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
        <div role="radiogroup" aria-label="选择模型提供商" className="grid grid-cols-2 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={provider === p.key}
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
            placeholder={initialApiKeyMasked ? '输入新 Key 可更换（留空则保留原 Key）' : provider === 'deepseek' ? 'sk-…' : '粘贴你的 API Key'}
            spellCheck={false}
            autoComplete="off"
            aria-label="API Key 输入框"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm outline-none transition-colors focus:border-brand"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
            aria-pressed={showKey}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:text-slate-600"
            title={showKey ? '隐藏' : '显示'}
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
        {/* 已配置 Key 的脱敏展示（输入新 Key 时自动隐藏） */}
        {initialApiKeyMasked && !apiKey && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <span className="flex-1 truncate">已配置：{initialApiKeyMasked}</span>
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              className="shrink-0 font-medium text-emerald-600 underline decoration-emerald-300 transition-colors hover:text-emerald-700"
            >
              更换
            </button>
          </div>
        )}
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
          aria-expanded={showAdvanced}
          aria-controls="fc-apikey-advanced"
          className="mt-3 flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700"
        >
          <span
            className={`inline-block transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            ▶
          </span>
          高级选项（Base URL / 模型）
        </button>
        {showAdvanced && (
          <div id="fc-apikey-advanced" className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-[11px] text-slate-500">Base URL</p>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com"
                spellCheck={false}
                aria-label="Base URL"
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
                aria-label="模型名"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand"
              />
            </div>
          </div>
        )}

        {testMsg && (
          <p className={`mt-3 text-xs ${testMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>
            {testMsg.text}
          </p>
        )}
        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        {saved && (
          <p className="mt-3 text-xs text-emerald-600">
            {apiKey.trim() ? '✓ API Key 已保存，即将开始…' : '✓ 设置已保存'}
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            disabled={saving || saved || testing}
            onClick={() => void handleSave()}
            className="flex-1 rounded-lg bg-brand py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {testing
              ? '正在测试连接…'
              : saving
                ? '保存中…'
                : saved
                  ? '已保存 ✓'
                  : wasInvite && apiKey.trim()
                    ? '保存并开始'
                    : apiKey.trim()
                      ? '测试连接并保存'
                      : '保存设置'}
          </button>
          {/* v3.2.1 P2-5：仅首启引导态（wasInvite）显示"稍后再说"，避免已配置 Key 时
              用户点"稍后"误以为配置没保存。已配置用户用 X / 遮罩关闭即可。 */}
          {wasInvite ? (
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-500 transition-colors hover:bg-slate-50"
            >
              稍后再说
            </button>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-500 transition-colors hover:bg-slate-50"
              title="取消编辑并关闭"
            >
              取消
            </button>
          )}
        </div>
      </div>

      <p className="border-t border-slate-100 bg-slate-50 px-7 py-3 text-center text-[11px] text-slate-400">
        🔒 API Key 仅保存在本地（系统级加密），不会上传到任何服务器
      </p>
    </dialog>
  );
}
