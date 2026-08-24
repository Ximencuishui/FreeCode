import { useState } from 'react';
import type {
  DeployConfig,
  DbProvider,
  EmailPreset,
  LoginConfig,
  LoginMethod,
} from '@shared/types/export';
import type {
  CloudDbProvider,
  CloudDbProviderMeta,
  DbProvisionInfo,
} from '@shared/types/dbprovision';

/**
 * 上线配置向导（导出前的地基 UI）。
 * 五步：数据库 → 登录方式 → 邮箱 → JWT → 确认导出。
 * 设计原则：默认零配置、可跳过、第三方密钥可后补；用户只做「点选 + 照表单填」。
 * 数据库步骤支持「一键申请云数据库」：填 API Key 后由主进程调用云服务商 API
 * 自动创建（Neon / Supabase，免费 500MB），连接信息自动回填。
 */

interface DeployConfigWizardProps {
  config: DeployConfig;
  onChange: (config: DeployConfig) => void;
  onFinish: () => void;
  onClose: () => void;
}

const STEPS = ['数据库', '登录方式', '邮箱', '登录保持', '确认导出'] as const;

/** 第三方登录申请入口（无法自动化，提供一键跳转申请页） */
const OAUTH_GUIDES: Record<Exclude<LoginMethod, 'password'>, { label: string; url: string }> = {
  wechat: { label: '微信开放平台', url: 'https://open.weixin.qq.com/' },
  douyin: { label: '抖音开放平台', url: 'https://open.douyin.com/' },
  google: { label: 'Google Cloud Console', url: 'https://console.cloud.google.com/apis/credentials' },
  github: { label: 'GitHub Developers', url: 'https://github.com/settings/developers' },
};

const LOGIN_LABELS: Record<LoginMethod, string> = {
  password: '账号密码登录',
  wechat: '微信登录',
  douyin: '抖音登录',
  google: '谷歌登录',
  github: 'GitHub 登录',
};

const EMAIL_PRESETS: { value: EmailPreset; label: string; host: string; port: number }[] = [
  { value: 'qq', label: 'QQ 邮箱', host: 'smtp.qq.com', port: 465 },
  { value: '163', label: '网易 163 邮箱', host: 'smtp.163.com', port: 465 },
  { value: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 587 },
  { value: 'other', label: '其他服务商', host: '', port: 465 },
];

const DB_OPTIONS: { value: DbProvider; label: string; desc: string }[] = [
  { value: 'sqlite', label: '本地数据库', desc: '零配置，自动创建，适合个人或小规模使用' },
  { value: 'mysql', label: 'MySQL', desc: '更强大，适合需要独立数据库的场景' },
  { value: 'postgres', label: 'PostgreSQL', desc: '功能最全，适合复杂数据需求' },
];

/** 云数据库服务商元信息（一键申请入口使用；Neon/Supabase 均为托管 PostgreSQL） */
const CLOUD_DB_META: Record<CloudDbProvider, CloudDbProviderMeta> = {
  neon: {
    provider: 'neon',
    label: 'Neon',
    desc: 'Serverless PostgreSQL，秒级开通',
    quota: '免费 500MB',
    keyLabel: 'Neon API Key',
    keyPlaceholder: 'napi_…',
    keyUrl: 'https://console.neon.tech/account/api-keys',
    regions: [
      { label: '美国东部（默认）', regionId: 'aws-us-east-2' },
      { label: '美国西部', regionId: 'aws-us-west-2' },
      { label: '亚太（新加坡）', regionId: 'aws-ap-southeast-1' },
    ],
  },
  supabase: {
    provider: 'supabase',
    label: 'Supabase',
    desc: '托管 PostgreSQL + 后端服务',
    quota: '免费 500MB',
    keyLabel: 'Supabase Access Token',
    keyPlaceholder: 'sbp_…',
    keyUrl: 'https://supabase.com/dashboard/account/tokens',
    regions: [
      { label: '美国东部（默认）', regionId: 'us-east-1' },
      { label: '美国西部', regionId: 'us-west-1' },
      { label: '亚太（新加坡）', regionId: 'ap-southeast-1' },
      { label: '欧洲中部', regionId: 'eu-central-1' },
    ],
  },
};

const CLOUD_DB_ORDER: CloudDbProvider[] = ['neon', 'supabase'];

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-brand focus:outline-none';
const labelCls = 'mb-1 block text-xs font-medium text-slate-500';

/** 输入框（受控 + 非空校验标记） */
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  error?: boolean;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type={type}
        className={`${inputCls} ${error ? 'border-red-300' : ''}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function DeployConfigWizard({
  config,
  onChange,
  onFinish,
  onClose,
}: DeployConfigWizardProps) {
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false); // 点击过下一步后显示校验提示

  // —— 一键申请云数据库状态 ——
  const [cloudUseMode, setCloudUseMode] = useState<'provision' | 'manual'>('provision');
  const [cloudProvider, setCloudProvider] = useState<CloudDbProvider>('neon');
  const [apiKey, setApiKey] = useState('');
  const [dbName, setDbName] = useState('');
  const [region, setRegion] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<DbProvisionInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const update = (patch: Partial<DeployConfig>) => onChange({ ...config, ...patch });
  const updateDb = (patch: Partial<DeployConfig['db']>) =>
    update({ db: { ...config.db, ...patch } });
  const updateLogin = (patch: Partial<LoginConfig>) =>
    update({ login: { ...config.login, ...patch } });
  const updateEmail = (patch: Partial<DeployConfig['email']>) =>
    update({ email: { ...config.email, ...patch } });

  const isCloud = config.db.provider !== 'sqlite' && config.db.mode === 'cloud';
  const isDockerDb = config.db.provider !== 'sqlite' && config.db.mode !== 'cloud';
  /** 一键申请仅对 PostgreSQL 有效（Neon / Supabase 均为托管 PostgreSQL） */
  const canProvision = config.db.provider === 'postgres';

  /** 选择数据库类型时重置一键申请状态，避免残留旧连接信息 */
  const selectDbProvider = (provider: DbProvider) => {
    updateDb({ provider, mode: 'docker' });
    setProvisioned(null);
    setProvisionError(null);
  };

  /** 调用主进程 db:provision，成功后自动回填连接信息 */
  const handleProvision = async () => {
    if (provisioning) return;
    setProvisioning(true);
    setProvisionError(null);
    setProvisioned(null);
    try {
      const result = await window.electron.db.provision({
        provider: cloudProvider,
        apiKey,
        name: dbName.trim() || undefined,
        region: region.trim() || undefined,
      });
      if (result.success) {
        const info = result.db;
        setProvisioned(info);
        updateDb({
          mode: 'cloud',
          host: info.host,
          port: info.port,
          name: info.name,
          user: info.user,
          password: info.password,
          cloudProvider: info.provider,
          instanceId: info.instanceId,
        });
      } else {
        setProvisionError(result.error?.message ?? '云数据库申请失败');
      }
    } catch (err) {
      setProvisionError(err instanceof Error ? err.message : '云数据库申请失败，请重试');
    } finally {
      setProvisioning(false);
    }
  };

  const copyConnection = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时忽略（仍可手动选择复制）
    }
  };

  /** 当前步骤是否填写完整 */
  const stepValid = (): boolean => {
    if (step === 0 && isCloud) {
      return Boolean(config.db.host?.trim());
    }
    if (step === 1) {
      return config.login.methods.every((m) => {
        if (m === 'password') return true;
        const oauth = config.login[m];
        return Boolean(oauth?.clientId?.trim() && oauth?.clientSecret?.trim());
      });
    }
    if (step === 2 && config.email.enabled) {
      return Boolean(
        config.email.smtpHost?.trim() &&
          config.email.smtpUser?.trim() &&
          config.email.smtpPassword?.trim(),
      );
    }
    return true;
  };

  const handleNext = () => {
    if (!stepValid()) {
      setTouched(true);
      return;
    }
    setTouched(false);
    setStep((s) => s + 1);
  };

  const toggleLogin = (method: Exclude<LoginMethod, 'password'>) => {
    const has = config.login.methods.includes(method);
    updateLogin({
      methods: has
        ? config.login.methods.filter((m) => m !== method)
        : [...config.login.methods, method],
    });
  };

  const setEmailPreset = (preset: EmailPreset) => {
    const p = EMAIL_PRESETS.find((e) => e.value === preset);
    updateEmail({
      preset,
      smtpHost: p?.host,
      smtpPort: p?.port,
    });
  };

  const openGuide = (method: Exclude<LoginMethod, 'password'>) => {
    void window.electron.app.openExternal(OAUTH_GUIDES[method].url);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 标题 + 步骤条 */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800">🚀 上线配置</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      <div className="mb-4 flex items-center gap-1">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <div key={label} className="flex items-center">
              {i > 0 && (
                <span className={`mx-1 h-px w-5 ${done || current ? 'bg-brand' : 'bg-slate-200'}`} />
              )}
              <span
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  current
                    ? 'bg-brand/10 font-medium text-brand'
                    : done
                      ? 'text-slate-500'
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
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* 步骤内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {/* Step 1: 数据库 */}
        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              您的数据存放在哪里？<span className="text-slate-400">（推荐先用本地，以后可迁移）</span>
            </p>
            <div className="space-y-2">
              {DB_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => selectDbProvider(opt.value)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                    config.db.provider === opt.value
                      ? 'border-brand bg-brand/5'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      config.db.provider === opt.value
                        ? 'border-brand bg-brand'
                        : 'border-slate-300'
                    }`}
                  >
                    {config.db.provider === opt.value && (
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    )}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{opt.label}</span>
                    <span className="block text-xs text-slate-500">{opt.desc}</span>
                  </span>
                </button>
              ))}
            </div>

            {config.db.provider !== 'sqlite' && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">数据库部署方式</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      updateDb({ mode: 'docker' });
                      setProvisioned(null);
                      setProvisionError(null);
                    }}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                      isDockerDb
                        ? 'border-brand bg-brand/5 text-brand'
                        : 'border-slate-300 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    内置数据库（推荐）
                  </button>
                  <button
                    type="button"
                    onClick={() => updateDb({ mode: 'cloud' })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                      isCloud
                        ? 'border-brand bg-brand/5 text-brand'
                        : 'border-slate-300 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    云数据库
                  </button>
                </div>
                {isDockerDb && (
                  <p className="text-xs text-slate-500">
                    无需任何配置，导出包会自动内置 {config.db.provider === 'mysql' ? 'MySQL' : 'PostgreSQL'} 数据库，开箱即用。
                  </p>
                )}
                {isCloud && (
                  <div className="space-y-3">
                    {/* 一键申请 / 手动填写 切换（仅 PostgreSQL 支持一键申请） */}
                    {canProvision && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setCloudUseMode('provision')}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                            cloudUseMode === 'provision'
                              ? 'border-brand bg-brand/5 text-brand'
                              : 'border-slate-300 text-slate-600 hover:border-slate-400'
                          }`}
                        >
                          ✨ 一键申请（推荐）
                        </button>
                        <button
                          type="button"
                          onClick={() => setCloudUseMode('manual')}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                            cloudUseMode === 'manual'
                              ? 'border-brand bg-brand/5 text-brand'
                              : 'border-slate-300 text-slate-600 hover:border-slate-400'
                          }`}
                        >
                          手动填写
                        </button>
                      </div>
                    )}

                    {canProvision && cloudUseMode === 'provision' ? (
                      /* —— 一键申请云数据库 —— */
                      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">
                          填写云服务商 API Key，点击申请后由 FreeCoder 自动在云端创建数据库（免费
                          500MB，秒级开通），连接信息自动填入下方表单。
                        </p>
                        {/* 服务商选择 */}
                        <div className="space-y-2">
                          {CLOUD_DB_ORDER.map((p) => {
                            const meta = CLOUD_DB_META[p];
                            const active = cloudProvider === p;
                            return (
                              <button
                                key={p}
                                type="button"
                                onClick={() => {
                                  setCloudProvider(p);
                                  setProvisioned(null);
                                  setProvisionError(null);
                                }}
                                className={`flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                                  active
                                    ? 'border-brand bg-brand/5'
                                    : 'border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                <span
                                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                    active ? 'border-brand bg-brand' : 'border-slate-300'
                                  }`}
                                >
                                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                                </span>
                                <span>
                                  <span className="block text-sm font-medium text-slate-800">
                                    {meta.label}{' '}
                                    <span className="text-xs font-normal text-brand">
                                      {meta.quota}
                                    </span>
                                  </span>
                                  <span className="block text-xs text-slate-500">{meta.desc}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {/* API Key */}
                        <div>
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-xs font-medium text-slate-500">
                              {CLOUD_DB_META[cloudProvider].keyLabel}
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                void window.electron.app.openExternal(
                                  CLOUD_DB_META[cloudProvider].keyUrl,
                                )
                              }
                              className="text-xs font-medium text-brand hover:underline"
                            >
                              获取 API Key ↗
                            </button>
                          </div>
                          <input
                            type="password"
                            className={inputCls}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={CLOUD_DB_META[cloudProvider].keyPlaceholder}
                          />
                        </div>
                        {/* 数据库名 + 区域 */}
                        <div className="grid grid-cols-2 gap-2">
                          <Field
                            label="数据库名（可选）"
                            value={dbName}
                            onChange={setDbName}
                            placeholder="自动生成"
                          />
                          <div>
                            <label className={labelCls}>区域（可选）</label>
                            <select
                              className={inputCls}
                              value={region}
                              onChange={(e) => setRegion(e.target.value)}
                            >
                              <option value="">默认区域</option>
                              {CLOUD_DB_META[cloudProvider].regions.map((r) => (
                                <option key={r.regionId} value={r.regionId}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {/* 申请按钮 */}
                        <button
                          type="button"
                          onClick={handleProvision}
                          disabled={provisioning || !apiKey.trim()}
                          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {provisioning ? '⏳ 正在云端创建数据库…' : '🚀 一键申请数据库'}
                        </button>
                        {provisionError && (
                          <p className="text-xs text-red-500">{provisionError}</p>
                        )}
                        {touched && !config.db.host?.trim() && !provisioning && (
                          <p className="text-xs text-red-500">
                            请先点击「一键申请数据库」，或切换到「手动填写」
                          </p>
                        )}
                        {/* 申请成功回显 */}
                        {provisioned && (
                          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                            <p className="text-sm font-medium text-emerald-700">
                              ✅ 数据库创建成功，连接信息已自动填入
                            </p>
                            <div className="flex items-center justify-between gap-2">
                              <code className="min-w-0 flex-1 truncate text-xs text-slate-700">
                                {provisioned.connectionString}
                              </code>
                              <button
                                type="button"
                                onClick={() => void copyConnection(provisioned.connectionString)}
                                className="shrink-0 rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                              >
                                {copied ? '已复制 ✓' : '复制连接串'}
                              </button>
                            </div>
                            <p className="text-[11px] text-emerald-600">
                              实例 ID：{provisioned.instanceId} · {provisioned.host}:
                              {provisioned.port}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* —— 手动填写 —— */
                      <div className="space-y-2">
                        <p className="text-xs text-slate-500">
                          填写云数据库连接信息（如腾讯云/阿里云数据库购买页提供）
                        </p>
                        <Field
                          label="服务器地址"
                          value={config.db.host ?? ''}
                          onChange={(v) => updateDb({ host: v })}
                          placeholder="例如：rm-xxx.mysql.tencentcdb.com"
                          error={touched && !config.db.host?.trim()}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Field
                            label="端口"
                            value={config.db.port ? String(config.db.port) : ''}
                            onChange={(v) => updateDb({ port: Number(v) || undefined })}
                            placeholder={config.db.provider === 'mysql' ? '3306' : '5432'}
                          />
                          <Field
                            label="数据库名"
                            value={config.db.name ?? ''}
                            onChange={(v) => updateDb({ name: v })}
                            placeholder="freecoder"
                          />
                        </div>
                        <Field
                          label="用户名"
                          value={config.db.user ?? ''}
                          onChange={(v) => updateDb({ user: v })}
                          placeholder="freecoder"
                        />
                        <Field
                          label="密码"
                          type="password"
                          value={config.db.password ?? ''}
                          onChange={(v) => updateDb({ password: v })}
                          placeholder="数据库密码"
                        />
                        {touched && !config.db.host?.trim() && (
                          <p className="text-xs text-red-500">请填写服务器地址</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 2: 登录方式 */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              用户如何登录您的应用？<span className="text-slate-400">（账号密码始终可用）</span>
            </p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              ✅ 账号密码登录（默认启用，无需申请）
            </div>
            {(['wechat', 'douyin', 'google', 'github'] as const).map((method) => {
              const checked = config.login.methods.includes(method);
              const oauth = config.login[method];
              return (
                <div
                  key={method}
                  className={`rounded-xl border p-3 ${
                    checked ? 'border-brand bg-brand/5' : 'border-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleLogin(method)}
                    className="flex w-full items-center justify-between"
                  >
                    <span className="text-sm font-medium text-slate-800">
                      {LOGIN_LABELS[method]}
                    </span>
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                        checked ? 'border-brand bg-brand text-white' : 'border-slate-300'
                      }`}
                    >
                      {checked ? '✓' : ''}
                    </span>
                  </button>
                  {checked && (
                    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500">
                          在 {OAUTH_GUIDES[method].label} 创建应用后获得
                        </p>
                        <button
                          type="button"
                          onClick={() => openGuide(method)}
                          className="text-xs font-medium text-brand hover:underline"
                        >
                          去申请密钥 ↗
                        </button>
                      </div>
                      <Field
                        label="Client ID"
                        value={oauth?.clientId ?? ''}
                        onChange={(v) => updateLogin({ [method]: { ...oauth, clientId: v } })}
                        placeholder="粘贴应用 Client ID"
                        error={touched && !oauth?.clientId?.trim()}
                      />
                      <Field
                        label="Client Secret"
                        type="password"
                        value={oauth?.clientSecret ?? ''}
                        onChange={(v) =>
                          updateLogin({ [method]: { ...oauth, clientSecret: v } })
                        }
                        placeholder="粘贴应用 Client Secret"
                        error={touched && !oauth?.clientSecret?.trim()}
                      />
                      {touched && (!oauth?.clientId?.trim() || !oauth?.clientSecret?.trim()) && (
                        <p className="text-xs text-red-500">
                          请填写密钥，或取消勾选「{LOGIN_LABELS[method]}」
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Step 3: 邮箱 */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">开启邮箱服务</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  用于发送注册验证码、找回密码邮件（可稍后补充）
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.email.enabled}
                onClick={() => updateEmail({ enabled: !config.email.enabled })}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  config.email.enabled ? 'bg-brand' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    config.email.enabled ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            {config.email.enabled && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div>
                  <label className={labelCls}>邮箱服务商</label>
                  <select
                    className={inputCls}
                    value={config.email.preset ?? 'qq'}
                    onChange={(e) => setEmailPreset(e.target.value as EmailPreset)}
                  >
                    {EMAIL_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    SMTP 地址与端口已按所选服务商自动填好，可手动修改
                  </p>
                </div>
                <Field
                  label="SMTP 服务器"
                  value={config.email.smtpHost ?? ''}
                  onChange={(v) => updateEmail({ smtpHost: v })}
                  placeholder="smtp.qq.com"
                  error={touched && !config.email.smtpHost?.trim()}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Field
                    label="SMTP 端口"
                    value={config.email.smtpPort ? String(config.email.smtpPort) : ''}
                    onChange={(v) => updateEmail({ smtpPort: Number(v) || undefined })}
                    placeholder="465"
                  />
                  <Field
                    label="发件人名称"
                    value={config.email.fromName ?? ''}
                    onChange={(v) => updateEmail({ fromName: v })}
                    placeholder="默认使用应用名"
                  />
                </div>
                <Field
                  label="发件邮箱"
                  value={config.email.smtpUser ?? ''}
                  onChange={(v) => updateEmail({ smtpUser: v })}
                  placeholder="yourname@qq.com"
                  error={touched && !config.email.smtpUser?.trim()}
                />
                <Field
                  label="SMTP 授权码"
                  type="password"
                  value={config.email.smtpPassword ?? ''}
                  onChange={(v) => updateEmail({ smtpPassword: v })}
                  placeholder="在邮箱设置中开启 SMTP 后获得"
                  error={touched && !config.email.smtpPassword?.trim()}
                />
                {touched &&
                  (!config.email.smtpHost?.trim() ||
                    !config.email.smtpUser?.trim() ||
                    !config.email.smtpPassword?.trim()) && (
                    <p className="text-xs text-red-500">请补全 SMTP 服务器、发件邮箱与授权码</p>
                  )}
              </div>
            )}
          </div>
        )}

        {/* Step 4: JWT */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">用户登录后可以保持登录多长时间？</p>
            <div className="flex flex-wrap gap-2">
              {[7, 30, 90, 365].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => update({ jwt: { expiresInDays: days } })}
                  className={`rounded-lg border px-4 py-2 text-sm ${
                    config.jwt.expiresInDays === days
                      ? 'border-brand bg-brand/5 text-brand'
                      : 'border-slate-300 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  {days === 7 ? '7 天（推荐）' : days === 30 ? '30 天' : days === 90 ? '90 天' : '1 年'}
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              🔒 安全密钥会在导出时自动生成并写入 .env，无需您手动设置。
            </div>
          </div>
        )}

        {/* Step 5: 确认导出 */}
        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">确认以下配置，导出后即可按指引上线。</p>
            <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">数据库</span>
                <span className="text-right font-medium text-slate-800">
                  {config.db.provider === 'sqlite'
                    ? '本地数据库（零配置）'
                    : config.db.mode === 'cloud'
                      ? `云数据库 ${config.db.provider.toUpperCase()}${
                          config.db.cloudProvider
                            ? `（${CLOUD_DB_META[config.db.cloudProvider].label} 一键创建）`
                            : ''
                        }`
                      : `${config.db.provider.toUpperCase()}（内置）`}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">登录方式</span>
                <span className="text-right font-medium text-slate-800">
                  {config.login.methods.map((m) => LOGIN_LABELS[m]).join('、')}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">邮箱</span>
                <span className="text-right font-medium text-slate-800">
                  {config.email.enabled ? `已开启（${config.email.smtpHost}）` : '未开启'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">登录保持</span>
                <span className="text-right font-medium text-slate-800">
                  {config.jwt.expiresInDays} 天
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              💡 全部配置均写入部署包的 .env 文件，可直接使用；上线后也可随时重新导出修改。
            </p>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => {
              setTouched(false);
              setStep((s) => s - 1);
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            上一步
          </button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover"
          >
            下一步
          </button>
        ) : (
          <button
            type="button"
            onClick={onFinish}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover"
          >
            🚀 开始导出
          </button>
        )}
      </div>
    </div>
  );
}
