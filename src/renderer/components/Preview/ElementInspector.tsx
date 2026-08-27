import { useState } from 'react';
import type { ElementInfo, ElementSelectResult } from '@shared/types/preview';
import MiniChat from '../Chat/MiniChat';

interface ElementInspectorProps {
  element: ElementInfo;
  info: NonNullable<ElementSelectResult['elementInfo']>;
  isProcessing: boolean;
  onSendModify: (instruction: string) => void;
}

/** 色卡：常用颜色 */
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
  return (
    <button
      type="button"
      title={`${c.name}（${c.hex}）`}
      onClick={() => onPick(`把颜色改成${c.name}色（${c.hex}）`)}
      className="flex aspect-square items-center justify-center rounded-md border border-slate-200 text-[9px] text-slate-400 transition-transform hover:scale-110"
      style={{ backgroundColor: c.hex, color: c.hex === '#FFFFFF' ? '#9CA3AF' : '#fff' }}
    >
      {c.name}
    </button>
  );
}

/** 元素检查器：元素信息 + 12 种快捷调整选择卡 + 内嵌修改对话（选中元素自动带上元素上下文） */
export default function ElementInspector({ element, info }: ElementInspectorProps) {
  const [instruction, setInstruction] = useState('');
  const [activePicker, setActivePicker] = useState<string | null>(null);

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
                  onClick={() => pick(`把背景改成${c.name}色（${c.hex}）`)}
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
          <PickerCard title="请在下方输入框中输入要改成的文字（输入框已自动填入「把文字改成：」）。" />
        )}
      </div>

      {/* 卡片 2：修改对话（灰底独立卡片；选中元素自动带上元素上下文；快捷选择自动填入指令） */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
        <p className="mb-1.5 text-xs font-medium text-slate-600">💬 修改对话</p>
        <MiniChat
          placeholder="例如：颜色太深了，调亮一点"
          value={instruction}
          onValueChange={setInstruction}
        />
      </div>
    </div>
  );
}
