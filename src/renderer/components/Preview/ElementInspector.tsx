import { useState } from 'react';
import type { ElementInfo, ElementSelectResult } from '@shared/types/preview';

interface ElementInspectorProps {
  element: ElementInfo;
  info: NonNullable<ElementSelectResult['elementInfo']>;
  isProcessing: boolean;
  onSendModify: (instruction: string) => void;
}

/** 元素检查器（前端设计说明书 3.3：右侧面板显示元素属性与修改入口） */
export default function ElementInspector({
  element,
  info,
  isProcessing,
  onSendModify,
}: ElementInspectorProps) {
  const [instruction, setInstruction] = useState('');

  const styles = [
    { label: '颜色', value: element.styles.color },
    { label: '字号', value: element.styles.fontSize },
    { label: '字重', value: element.styles.fontWeight },
    { label: '背景', value: element.styles.backgroundColor },
    { label: '圆角', value: element.styles.borderRadius },
    { label: '内边距', value: element.styles.padding },
    { label: '外边距', value: element.styles.margin },
  ].filter((s): s is { label: string; value: string } => Boolean(s.value));

  const applyAction = (action: string) => {
    const hints: Record<string, string> = {
      'change-color': '颜色太深了，帮我调亮一点',
      'change-size': '字号再大一点',
      'edit-text': '把文字改成：',
    };
    setInstruction(hints[action] ?? '');
  };

  return (
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
            onClick={() => applyAction(action.action)}
            className="rounded-full border border-brand px-2.5 py-1 text-xs text-brand hover:bg-brand hover:text-white"
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="mb-1.5 text-xs text-slate-400">或者直接告诉我您想怎么改：</p>
        <div className="flex gap-2">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && instruction.trim() && !isProcessing) {
                onSendModify(instruction.trim());
                setInstruction('');
              }
            }}
            placeholder="例如：颜色太深了"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={!instruction.trim() || isProcessing}
            onClick={() => {
              onSendModify(instruction.trim());
              setInstruction('');
            }}
            className="rounded-lg bg-brand px-3 text-sm text-white disabled:opacity-40"
          >
            修改
          </button>
        </div>
      </div>
    </div>
  );
}
