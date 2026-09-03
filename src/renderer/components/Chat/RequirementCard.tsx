import { useState } from 'react';
import type { RequirementSummary, ProjectStatus } from '@shared/types/project';
import ConfirmDialog from '../common/ConfirmDialog';

interface RequirementCardProps {
  requirements: RequirementSummary;
  status?: ProjectStatus | null;
  /** 确认需求（可传 true 跳过 AI 审查） */
  onConfirm: (skipReview?: boolean) => void;
  /** 保存编辑后的需求（返回是否成功） */
  onUpdate?: (patch: Partial<RequirementSummary>) => Promise<boolean>;
  /** 需求审查发现矛盾后为 true：显示"跳过审查"逃生口 */
  reviewPending?: boolean;
}

const DEVICE_LABEL: Record<string, string> = {
  desktop: '电脑',
  mobile: '手机',
  both: '电脑 + 手机',
};
const AUTH_LABEL: Record<string, string> = {
  none: '不需要登录',
  password: '账号密码',
  wechat: '微信登录',
  sms: '手机号验证码',
};
const SCALE_LABEL: Record<string, string> = {
  solo: '自己用',
  team: '小团队',
  public: '公开多人',
};
const LANG_LABEL: Record<string, string> = {
  'zh-CN': '简体中文',
  'en-US': '英文',
  both: '中英双语',
};
const PLATFORM_LABEL: Record<string, string> = {
  web: '网页',
  'mini-program': '小程序',
  both: '网页 + 小程序',
};

const ENUM_OPTIONS: Record<string, [string, string][]> = {
  device: Object.entries(DEVICE_LABEL),
  authentication: Object.entries(AUTH_LABEL),
  usageScale: Object.entries(SCALE_LABEL),
  uiLanguage: Object.entries(LANG_LABEL),
  platform: Object.entries(PLATFORM_LABEL),
};

/** 分栏：栏标题前加圆点，栏间加细分隔线 */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 py-2.5 first:border-t-0 first:pt-0">
      <dt className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
        {label}
      </dt>
      <dd className="text-sm leading-relaxed text-slate-700">{children}</dd>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-brand';
const textareaCls =
  'w-full resize-y rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-brand';

/** 需求卡片（前端设计说明书 3.4）：确认前可编辑需求项，确认时 AI 先审查矛盾 */
export default function RequirementCard({
  requirements,
  status,
  onConfirm,
  onUpdate,
  reviewPending,
}: RequirementCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RequirementSummary>(requirements);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // v3.2.1 P1-1：替代 window.confirm 的二次确认状态。null = 未弹窗。
  const [pendingEditPhase, setPendingEditPhase] = useState<string | null>(null);

  const confirmed: boolean =
    requirements.confirmed ||
    status === 'planned' ||
    status === 'developing' ||
    status === 'ready' ||
    status === 'exported';

  const setText = (key: keyof RequirementSummary, v: string) =>
    setDraft((d) => ({ ...d, [key]: v }));
  const setList = (key: keyof RequirementSummary, v: string) =>
    setDraft((d) => ({ ...d, [key]: v.split('\n').map((s) => s.trim()).filter(Boolean) }));
  const setEnum = (key: keyof RequirementSummary, v: string) =>
    setDraft((d) => ({ ...d, [key]: v }));

  const startEdit = () => {
    setDraft({ ...requirements });
    setError('');
    setEditing(true);
  };

  const confirmPendingEdit = () => {
    setPendingEditPhase(null);
    startEdit();
  };

  const saveEdit = async () => {
    if (!onUpdate || saving) return;
    const patch: Partial<RequirementSummary> = {
      goal: draft.goal.trim(),
      targetUsers: draft.targetUsers.trim(),
      coreFeatures: draft.coreFeatures.map((s) => s.trim()).filter(Boolean),
      visualStyle: draft.visualStyle?.trim() || undefined,
      pages: draft.pages?.map((s) => s.trim()).filter(Boolean),
      layout: draft.layout?.trim() || undefined,
      styleFeeling: draft.styleFeeling?.trim() || undefined,
      device: draft.device,
      keyFlows: draft.keyFlows?.map((s) => s.trim()).filter(Boolean),
      authentication: draft.authentication,
      usageScale: draft.usageScale,
      exportFeatures: draft.exportFeatures?.map((s) => s.trim()).filter(Boolean),
      uiLanguage: draft.uiLanguage,
      platform: draft.platform,
    };
    if (!patch.goal || (patch.coreFeatures ?? []).length === 0) {
      setError('「一句话目标」和「核心功能」不能为空');
      return;
    }
    setSaving(true);
    setError('');
    const ok = await onUpdate(patch);
    setSaving(false);
    if (ok) setEditing(false);
    else setError('保存失败，请重试');
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">📋 需求概要</h3>
        {confirmed ? (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600">✅ 已确认</span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600">待确认</span>
        )}
      </div>
      {/* v0.1.02 P2-2：开发中/已就绪状态也能编辑需求（PRD 2.1「用户可随时说'跳过'或'我也不知道'」隐含支持随时调整）。
          之前 !confirmed && status === 'draft' 只在草稿期可编辑，开发中用户发现漏写功能就只能重新确认一遍。
          现在 draft 状态直接进入编辑；planned/已确认状态下点击按钮先弹确认（开发可能在跑，要先警告再保存）。
          exported 状态拒绝编辑（项目已部署到外部，再改需求意义不大）。 */}
      {onUpdate && status !== 'exported' && (
        <div className="mb-2 text-right">
          <button
            type="button"
            onClick={() => {
              if (editing) {
                setEditing(false);
                return;
              }
              // planned/developing/ready：弹确认弹窗，避免用户误操作打断正在跑的开发
              if (status && status !== 'draft') {
                const phase =
                  status === 'planned'
                    ? '版本计划已生成'
                    : status === 'developing'
                      ? '应用正在开发'
                      : '应用已就绪';
                setPendingEditPhase(phase);
              } else {
                startEdit();
              }
            }}
            className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 transition-colors hover:bg-slate-50"
          >
            {editing ? '取消编辑' : '✏️ 编辑需求'}
          </button>
        </div>
      )}

      {editing ? (
        <dl className="space-y-0">
          <FieldRow label="一句话目标">
            <textarea
              rows={2}
              value={draft.goal}
              onChange={(e) => setText('goal', e.target.value)}
              className={textareaCls}
            />
          </FieldRow>
          <FieldRow label="目标用户">
            <input
              value={draft.targetUsers}
              onChange={(e) => setText('targetUsers', e.target.value)}
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="核心功能（每行一个）">
            <textarea
              rows={4}
              value={draft.coreFeatures.join('\n')}
              onChange={(e) => setList('coreFeatures', e.target.value)}
              className={textareaCls}
            />
          </FieldRow>
          <FieldRow label="主要页面（每行一个）">
            <textarea
              rows={3}
              value={(draft.pages ?? []).join('\n')}
              onChange={(e) => setList('pages', e.target.value)}
              className={textareaCls}
            />
          </FieldRow>
          <FieldRow label="布局">
            <input
              value={draft.layout ?? ''}
              onChange={(e) => setText('layout', e.target.value)}
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="界面感觉">
            <input
              value={draft.styleFeeling ?? ''}
              onChange={(e) => setText('styleFeeling', e.target.value)}
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="视觉风格">
            <input
              value={draft.visualStyle ?? ''}
              onChange={(e) => setText('visualStyle', e.target.value)}
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="使用设备">
            <select
              value={draft.device ?? 'desktop'}
              onChange={(e) => setEnum('device', e.target.value)}
              className={inputCls}
            >
              {ENUM_OPTIONS.device.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="关键操作流程（每行一个）">
            <textarea
              rows={3}
              value={(draft.keyFlows ?? []).join('\n')}
              onChange={(e) => setList('keyFlows', e.target.value)}
              className={textareaCls}
            />
          </FieldRow>
          <FieldRow label="登录方式">
            <select
              value={draft.authentication ?? 'none'}
              onChange={(e) => setEnum('authentication', e.target.value)}
              className={inputCls}
            >
              {ENUM_OPTIONS.authentication.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="使用规模">
            <select
              value={draft.usageScale ?? 'solo'}
              onChange={(e) => setEnum('usageScale', e.target.value)}
              className={inputCls}
            >
              {ENUM_OPTIONS.usageScale.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="导出与分享（每行一个）">
            <textarea
              rows={2}
              value={(draft.exportFeatures ?? []).join('\n')}
              onChange={(e) => setList('exportFeatures', e.target.value)}
              className={textareaCls}
            />
          </FieldRow>
          <FieldRow label="界面语言">
            <select
              value={draft.uiLanguage ?? 'zh-CN'}
              onChange={(e) => setEnum('uiLanguage', e.target.value)}
              className={inputCls}
            >
              {ENUM_OPTIONS.uiLanguage.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="平台">
            <select
              value={draft.platform ?? 'web'}
              onChange={(e) => setEnum('platform', e.target.value)}
              className={inputCls}
            >
              {ENUM_OPTIONS.platform.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </FieldRow>
          {error && <p className="pt-1 text-xs text-red-500">{error}</p>}
          <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveEdit()}
              className="flex-1 rounded-lg bg-brand py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-40"
            >
              {saving ? '保存中…' : '保存修改'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-50"
            >
              取消
            </button>
          </div>
        </dl>
      ) : (
        <dl className="space-y-0">
          <FieldRow label="一句话目标">
            {requirements.goal || '（待补充）'}
          </FieldRow>
          <FieldRow label="目标用户">
            {requirements.targetUsers || '（待补充）'}
          </FieldRow>
          <FieldRow label="核心功能">
            {requirements.coreFeatures.length > 0 ? (
              <ul className="list-inside list-disc space-y-0.5">
                {requirements.coreFeatures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              '（待补充）'
            )}
          </FieldRow>
          {requirements.pages && requirements.pages.length > 0 && (
            <FieldRow label="主要页面">
              <ul className="list-inside list-disc space-y-0.5">
                {requirements.pages.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </FieldRow>
          )}
          {requirements.layout && <FieldRow label="布局">{requirements.layout}</FieldRow>}
          {requirements.styleFeeling && (
            <FieldRow label="界面感觉">{requirements.styleFeeling}</FieldRow>
          )}
          {requirements.visualStyle && (
            <FieldRow label="视觉风格">{requirements.visualStyle}</FieldRow>
          )}
          {requirements.device && (
            <FieldRow label="使用设备">{DEVICE_LABEL[requirements.device]}</FieldRow>
          )}
          {requirements.keyFlows && requirements.keyFlows.length > 0 && (
            <FieldRow label="关键操作流程">
              <ul className="list-inside list-disc space-y-0.5">
                {requirements.keyFlows.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </FieldRow>
          )}
          {requirements.authentication && (
            <FieldRow label="登录方式">{AUTH_LABEL[requirements.authentication]}</FieldRow>
          )}
          {requirements.usageScale && (
            <FieldRow label="使用规模">{SCALE_LABEL[requirements.usageScale]}</FieldRow>
          )}
          {requirements.exportFeatures && requirements.exportFeatures.length > 0 && (
            <FieldRow label="导出与分享">
              <ul className="list-inside list-disc space-y-0.5">
                {requirements.exportFeatures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </FieldRow>
          )}
          {requirements.uiLanguage && (
            <FieldRow label="界面语言">{LANG_LABEL[requirements.uiLanguage]}</FieldRow>
          )}
          {requirements.platform && (
            <FieldRow label="平台">{PLATFORM_LABEL[requirements.platform] ?? requirements.platform}</FieldRow>
          )}
        </dl>
      )}

      {!editing && !confirmed && requirements.goal && (
        <>
          <button
            type="button"
            onClick={() => onConfirm()}
            className="mt-4 w-full rounded-lg bg-brand py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            确认需求，规划版本
          </button>
          {reviewPending && (
            <button
              type="button"
              onClick={() => onConfirm(true)}
              className="mt-1.5 w-full text-center text-[11px] text-slate-400 underline decoration-dotted transition-colors hover:text-slate-600"
            >
              跳过审查，直接确认
            </button>
          )}
        </>
      )}

      {status === 'planned' && (
        <div className="mt-3 text-center text-xs text-slate-400">
          正在规划版本分段，先做最小可用版本…
        </div>
      )}
      {status === 'ready' && (
        <div className="mt-3 text-center text-xs text-green-600">✅ 应用已就绪，点击左侧「预览」查看</div>
      )}

      {/* v3.2.1 P1-1：自研确认弹窗替代 window.confirm。
          v3.2.2 P0-3：弹窗文案根据「核心字段 vs 附属字段」是否改动给出不同提示——
          改核心字段（目标 / 目标用户 / 核心功能 / 关键流程）会触发项目状态回滚到草稿；
          只改附属字段（视觉风格 / 页面 / 设备 等）则保留状态，避免误吓用户。 */}
      <ConfirmDialog
        open={pendingEditPhase !== null}
        title="确认编辑已确认的需求？"
        description={
          pendingEditPhase
            ? `当前状态：${pendingEditPhase}。\n\n若改动了一句话目标 / 目标用户 / 核心功能 / 关键流程，系统会把项目回滚到「草稿」并清空版本计划，需要重新确认需求后才能继续开发。\n\n仅修改附属字段（视觉风格 / 页面 / 设备 / 登录方式等）不会触发回滚。\n\n如需让改动直接驱动开发，请保存后到对话里说「按新需求重新开发」。`
            : ''
        }
        confirmLabel="继续编辑"
        cancelLabel="先不编辑"
        tone="default"
        onCancel={() => setPendingEditPhase(null)}
        onConfirm={confirmPendingEdit}
      />
    </div>
  );
}
