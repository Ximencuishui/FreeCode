import { useEffect, useRef, useState } from 'react';
import type { ElementInfo, ElementSelectResult } from '@shared/types/preview';
import MiniChat from '../Chat/MiniChat';

interface ElementInspectorProps {
  element: ElementInfo;
  info: NonNullable<ElementSelectResult['elementInfo']>;
  isProcessing: boolean;
  onSendModify: (instruction: string) => void;
}

/** 色卡：常用颜色
 * v0.1.02 P3-4：每条带 hex（权威值，AI 直接拿来渲染）+ 中文名（仅供用户识别）。
 * 发给 AI 的指令以 hex 为主、中文名为辅，减小"中文 → 颜色"歧义（如"天蓝"vs"蓝"）。*/
const COLOR_PALETTE: { name: string; hex: string }[] = [
  { name: '红', hex: '#EF4444' },
  { name: '橙', hex: '#F97316' },
  { name: '琥珀', hex: '#F59E0B' },
  { name: '黄', hex: '#EAB308' },
  { name: '绿', hex: '#22C55E' },
  { name: '青', hex: '#14B8A6' },
  { name: '天蓝', hex: '#0EA5E9' },
  { name: '蓝', hex: '#3B82F6' },
  { name: '紫', hex: '#8B5CF6' },
  { name: '粉', hex: '#EC4899' },
  { name: '棕', hex: '#92400E' },
  { name: '黑', hex: '#111827' },
  { name: '灰', hex: '#6B7280' },
  { name: '白', hex: '#FFFFFF' },
];

/** 字号选择 */
const SIZE_OPTIONS: { label: string; px: number }[] = [
  { label: '小', px: 12 },
  { label: '中', px: 16 },
  { label: '大', px: 20 },
  { label: '特大', px: 28 },
];

/** 间距选择 */
const SPACING_OPTIONS: { label: string; px: number; desc: string }[] = [
  { label: '紧凑', px: 4, desc: '内容贴边框' },
  { label: '适中', px: 12, desc: '留出呼吸感' },
  { label: '宽松', px: 24, desc: '大间距' },
];

/** 对齐选择 */
const ALIGN_OPTIONS: { label: string; value: string }[] = [
  { label: '左对齐', value: 'left' },
  { label: '居中', value: 'center' },
  { label: '右对齐', value: 'right' },
];

/** 字重选择 */
const WEIGHT_OPTIONS: { label: string; value: string }[] = [
  { label: '常规', value: 'normal' },
  { label: '加粗', value: 'bold' },
];

/** 圆角选择 */
const RADIUS_OPTIONS: { label: string; px: number }[] = [
  { label: '直角', px: 0 },
  { label: '小圆角', px: 8 },
  { label: '大圆角', px: 16 },
  { label: '全圆', px: 9999 },
];

/** 边框粗细选择 */
const BORDER_WIDTH_OPTIONS: { label: string; px: number }[] = [
  { label: '无边框', px: 0 },
  { label: '细', px: 1 },
  { label: '中', px: 2 },
  { label: '粗', px: 4 },
];

/** 透明度选择 */
const OPACITY_OPTIONS: { label: string; pct: number }[] = [
  { label: '不透明', pct: 100 },
  { label: '半透明', pct: 60 },
  { label: '很透明', pct: 30 },
  { label: '几乎透明', pct: 15 },
];

/** 阴影选择 */
const SHADOW_OPTIONS: { label: string; level: 'none' | 'light' | 'medium' | 'heavy' }[] = [
  { label: '无阴影', level: 'none' },
  { label: '轻阴影', level: 'light' },
  { label: '中阴影', level: 'medium' },
  { label: '重阴影', level: 'heavy' },
];
const SHADOW_CSS: Record<string, string> = {
  none: 'none',
  light: '0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.24)',
  medium: '0 4px 8px rgba(0,0,0,.2), 0 2px 4px rgba(0,0,0,.16)',
  heavy: '0 10px 20px rgba(0,0,0,.3), 0 6px 6px rgba(0,0,0,.23)',
};

/** 行高选择 */
const LINE_HEIGHT_OPTIONS: { label: string; lh: number }[] = [
  { label: '紧凑', lh: 1.2 },
  { label: '标准', lh: 1.5 },
  { label: '宽松', lh: 1.8 },
];

/** 通用选择卡容器 */
function PickerCard({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <p className="mb-1.5 text-xs text-slate-500">{title}</p>
      {children}
    </div>
  );
}

/** 色卡按钮（文字色/背景色共用） */
function ColorSwatch({
  c,
  onPick,
}: {
  c: { name: string; hex: string };
  onPick: (instruction: string) => void;
}) {
  // v0.1.02 P3-4：指令里把 hex 放前面、附中文名作 hint，让 AI 直接采用 hex、不依赖颜色名解释。
  return (
    <button
      type="button"
      title={`${c.name}（${c.hex}）`}
      onClick={() => onPick(`把颜色改成 ${c.hex}（${c.name}）`)}
      className="flex aspect-square items-center justify-center rounded-md border border-slate-200 text-[9px] text-slate-400 transition-transform hover:scale-110"
      style={{ backgroundColor: c.hex, color: c.hex === '#FFFFFF' ? '#9CA3AF' : '#fff' }}
    >
      {c.name}
    </button>
  );
}

/** 元素检查器：元素信息 + 12 种快捷调整选择卡 + 内嵌修改对话（选中元素自动带上元素上下文）
 * v0.1.02 P1-4：isProcessing 用于驱动 MiniChat 的跑马灯状态（之前是死参数） */
export default function ElementInspector({ element, info, isProcessing }: ElementInspectorProps) {
  const [instruction, setInstruction] = useState('');
  const [activePicker, setActivePicker] = useState<string | null>(null);
  // v3.2.1 P1-6：edit-text 真实输入控件——之前只渲染一行提示文字，
  // 用户看不到能输入的地方。现在用一个本地 <input>，按 Enter 直接走 onSendModify。
  const [editText, setEditText] = useState('');
  const editTextRef = useRef<HTMLInputElement>(null);

  const styles = [
    { label: '颜色', value: element.styles.color },
    { label: '字号', value: element.styles.fontSize },
    { label: '字重', value: element.styles.fontWeight },
    { label: '背景', value: element.styles.backgroundColor },
    { label: '圆角', value: element.styles.borderRadius },
    { label: '内边距', value: element.styles.padding },
    { label: '外边距', value: element.styles.margin },
  ].filter((s): s is { label: string; value: string } => Boolean(s.value));

  const togglePicker = (action: string) => {
    setActivePicker((cur) => (cur === action ? null : action));
  };

  const pick = (text: string) => setInstruction(text);

  // v3.2.1 P1-6：edit-text 选中后自动聚焦输入框，让用户立刻打字。
  useEffect(() => {
    if (activePicker === 'edit-text') {
      setEditText('');
      // 切换面板 → 下一帧聚焦输入框
      queueMicrotask(() => editTextRef.current?.focus());
    }
  }, [activePicker]);

  return (
    <div className="space-y-3">
      {/* 卡片 1：元素信息 + 快捷操作选择卡 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">🔍 元素信息</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {element.tag}
          </span>
        </div>

        <p className="text-sm text-slate-700">{info.description}</p>

        {styles.length > 0 && (
          <dl className="mt-3 space-y-1 text-xs">
            {styles.map((s) => (
              <div key={s.label} className="flex justify-between">
                <dt className="text-slate-400">{s.label}</dt>
                <dd className="text-slate-600">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {info.suggestedActions.map((action) => (
            <button
              key={action.action}
              type="button"
              onClick={() => togglePicker(action.action)}
              aria-pressed={activePicker === action.action}
              aria-expanded={activePicker === action.action}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                activePicker === action.action
                  ? 'border-brand bg-brand text-white'
                  : 'border-brand text-brand hover:bg-brand hover:text-white'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>

        {activePicker === 'change-color' && (
          <PickerCard title="选择颜色（点击后自动填入修改指令）：">
            <div className="grid grid-cols-7 gap-1.5">
              {COLOR_PALETTE.map((c) => (
                <ColorSwatch key={c.hex} c={c} onPick={pick} />
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'change-bg' && (
          <PickerCard title="选择背景色（点击后自动填入修改指令）：">
            <div className="grid grid-cols-7 gap-1.5">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={`${c.name}（${c.hex}）`}
                  onClick={() => pick(`把背景改成 ${c.hex}（${c.name}）`)}
                  className="flex aspect-square items-center justify-center rounded-md border border-slate-200 text-[9px] text-slate-400 transition-transform hover:scale-110"
                  style={{ backgroundColor: c.hex, color: c.hex === '#FFFFFF' ? '#9CA3AF' : '#fff' }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'change-size' && (
          <PickerCard title="选择字号大小（点击后自动填入修改指令）：">
            <div className="grid grid-cols-4 gap-1.5">
              {SIZE_OPTIONS.map((s) => (
                <button
                  key={s.px}
                  type="button"
                  onClick={() => pick(`把字号改成 ${s.px}px（${s.label}）`)}
                  className="flex items-center justify-center rounded-md border border-slate-200 bg-white py-2 text-slate-600 transition-colors hover:border-brand hover:text-brand"
                >
                  <span style={{ fontSize: s.px }}>{s.label}</span>
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'change-spacing' && (
          <PickerCard title="选择间距（内边距，点击后自动填入修改指令）：">
            <div className="grid grid-cols-3 gap-1.5">
              {SPACING_OPTIONS.map((s) => (
                <button
                  key={s.px}
                  type="button"
                  onClick={() => pick(`把内边距改成 ${s.px}px（${s.label}）`)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-center text-xs text-slate-600 transition-colors hover:border-brand hover:text-brand"
                >
                  <span className="block font-medium">{s.label}</span>
                  <span className="text-[10px] text-slate-400">{s.desc}</span>
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'text-align' && (
          <PickerCard title="文字对齐方式：">
            <div className="grid grid-cols-3 gap-1.5">
              {ALIGN_OPTIONS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => pick(`文字${a.label}`)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 transition-colors hover:border-brand hover:text-brand"
                  style={{ textAlign: a.value as 'left' | 'center' | 'right' }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'font-weight' && (
          <PickerCard title="字体粗细：">
            <div className="grid grid-cols-2 gap-1.5">
              {WEIGHT_OPTIONS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => pick(`字体改为${w.label}`)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-600 transition-colors hover:border-brand hover:text-brand"
                >
                  <span style={{ fontWeight: w.value as 'normal' | 'bold' }}>示例文字</span>
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'border-radius' && (
          <PickerCard title="圆角样式：">
            <div className="grid grid-cols-4 gap-1.5">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r.px}
                  type="button"
                  onClick={() => pick(r.px === 9999 ? '圆角改成全圆' : `圆角改成 ${r.px}px（${r.label}）`)}
                  className="rounded-md border border-slate-200 bg-white px-1 py-2 text-center text-[10px] text-slate-600 transition-colors hover:border-brand hover:text-brand"
                >
                  <span
                    className="mx-auto block h-6 w-6 border border-slate-300 bg-slate-100"
                    style={{ borderRadius: r.px }}
                  />
                  {r.label}
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'border-width' && (
          <PickerCard title="边框粗细（以方块边框预览）：">
            <div className="grid grid-cols-4 gap-1.5">
              {BORDER_WIDTH_OPTIONS.map((b) => (
                <button
                  key={b.px}
                  type="button"
                  onClick={() => pick(b.px === 0 ? '去掉边框' : `边框粗细改成 ${b.px}px（${b.label}）`)}
                  className="rounded-md border border-slate-200 bg-white px-1 py-2 text-center text-[10px] text-slate-600 transition-colors hover:border-brand hover:text-brand"
                >
                  <span
                    className="mx-auto block h-6 w-6 border-slate-400"
                    style={{ borderWidth: b.px || 1, borderStyle: b.px ? 'solid' : 'dashed' }}
                  />
                  {b.label}
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'opacity' && (
          <PickerCard title="透明度（以方块深浅预览）：">
            <div className="grid grid-cols-4 gap-1.5">
              {OPACITY_OPTIONS.map((o) => (
                <button
                  key={o.pct}
                  type="button"
                  onClick={() => pick(`透明度改成 ${o.pct}%（${o.label}）`)}
                  className="rounded-md border border-slate-200 bg-white px-1 py-2 text-center text-[10px] text-slate-600 transition-colors hover:border-brand hover:text-brand"
                >
                  <span
                    className="mx-auto block h-6 w-6 bg-slate-700"
                    style={{ opacity: o.pct / 100 }}
                  />
                  {o.label}
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'shadow' && (
          <PickerCard title="阴影效果（以方块阴影预览）：">
            <div className="grid grid-cols-4 gap-1.5">
              {SHADOW_OPTIONS.map((s) => (
                <button
                  key={s.level}
                  type="button"
                  onClick={() => pick(s.level === 'none' ? '去掉阴影' : `添加${s.label}`)}
                  className="rounded-md border border-slate-200 bg-white px-1 py-2 text-center text-[10px] text-slate-600 transition-colors hover:border-brand hover:text-brand"
                >
                  <span
                    className="mx-auto block h-6 w-6 bg-white"
                    style={{ boxShadow: SHADOW_CSS[s.level] }}
                  />
                  {s.label}
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'line-height' && (
          <PickerCard title="行高（文字疏密预览）：">
            <div className="grid grid-cols-3 gap-1.5">
              {LINE_HEIGHT_OPTIONS.map((l) => (
                <button
                  key={l.lh}
                  type="button"
                  onClick={() => pick(`行高改成 ${l.lh}（${l.label}）`)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600 transition-colors hover:border-brand hover:text-brand"
                >
                  <span style={{ lineHeight: l.lh }} className="block">
                    两行文字
                    <br />
                    演示行高
                  </span>
                  {l.label}
                </button>
              ))}
            </div>
          </PickerCard>
        )}

        {activePicker === 'edit-text' && (
          // v3.2.1 P1-6：原来只渲染一行提示文字，用户看不到能输入的地方。
          // 现在用一个真 <input>，按 Enter 直接走 onSendModify 把"把文字改成 X"
          // 指令发给 AI，并把输入框清空以便连续修改。
          <PickerCard title="输入要改成的新文字（Enter 直接发送）：">
            <div className="flex gap-2">
              <input
                ref={editTextRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editText.trim()) {
                    e.preventDefault();
                    // 透传元素上下文给 AI（ElementInspector 外层 MiniChat 已有 elementContext，
                    // 这里直接调 onSendModify 走相同通道）。
                    pick(`把文字改成 "${editText.trim()}"`);
                    setEditText('');
                    setActivePicker(null);
                  }
                }}
                disabled={isProcessing}
                placeholder="例如：点击立即试用"
                aria-label="输入要改成的新文字"
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-brand disabled:bg-slate-50"
              />
              <button
                type="button"
                disabled={!editText.trim() || isProcessing}
                onClick={() => {
                  if (editText.trim()) {
                    pick(`把文字改成 "${editText.trim()}"`);
                    setEditText('');
                    setActivePicker(null);
                  }
                }}
                className="rounded-md bg-brand px-2.5 py-1 text-xs text-white transition-opacity hover:bg-brand-hover disabled:opacity-40"
              >
                发送
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              💡 指令会自动写入下方修改对话，可二次编辑后再按 Enter 发送
            </p>
          </PickerCard>
        )}
      </div>

      {/* 卡片 2：修改对话（灰底独立卡片；选中元素自动带上元素上下文；快捷选择自动填入指令）
          v0.1.02 P1-4：把 element 作为 elementContext 传给 MiniChat，确保每次发送都带元素上下文。
          （之前 isProcessing/onSendModify 是死参数，DSH 收不到 selectedElement。） */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
        <p className="mb-1.5 text-xs font-medium text-slate-600">💬 修改对话</p>
        <MiniChat
          placeholder="例如：颜色太深了，调亮一点"
          value={instruction}
          onValueChange={setInstruction}
          elementContext={element}
          marqueeOnProcessing
          marqueeText={isProcessing ? '🛠 修改进行中…' : undefined}
        />
      </div>
    </div>
  );
}
