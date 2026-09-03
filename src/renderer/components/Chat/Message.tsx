import { useState } from 'react';
import type { ChatMessageUI, ChatOption } from '../../store/chat';
import { extractQuestionBlocks } from '../../utils/options';
import { extractRequirementJson, type ChatRequirementJson } from '../../utils/requirements';

interface MessageProps {
  message: ChatMessageUI;
  disabled?: boolean;
  onSelectOption: (option: ChatOption) => void;
  /** 需求收敛卡片的 CTA：确认需求并进入版本规划 */
  onConfirmRequirements?: () => void;
  /** 是否已进入规划阶段（true 时 CTA 变为已确认状态） */
  requirementsConfirmed?: boolean;
}

/** 助理消息的思考过程折叠块（默认折叠，避免草稿与最终回复不一致造成困惑） */
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-amber-200/70 bg-amber-50/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100/60"
      >
        <span>💭 查看思考过程</span>
        <span className="ml-auto text-amber-500">{open ? '收起 ▴' : '展开 ▾'}</span>
      </button>
      {open && (
        <div className="border-t border-amber-200/70">
          <p className="px-3 pt-2 text-[10px] leading-relaxed text-amber-500/80">
            AI 内部思考草稿（含起草、自我修正，可能与最终回复不完全一致），仅供了解推理方向。
          </p>
          <div className="max-h-56 overflow-y-auto px-3 py-2 text-xs leading-relaxed text-slate-500">
            <div className="whitespace-pre-wrap">{text}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 问题卡片：高亮问题 + 大按钮选项，避免被长回复淹没 */
function QuestionCard({
  question,
  options,
  disabled,
  onSelect,
}: {
  question: string;
  options: ChatOption[];
  disabled?: boolean;
  onSelect: (option: ChatOption) => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-brand/25 bg-brand/5 p-3">
      <p className="mb-2 text-sm font-semibold leading-relaxed text-slate-800">{question}</p>
      <div className="flex flex-col gap-2">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt)}
            className="rounded-lg border border-brand/40 bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:border-brand hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-brand/40 disabled:hover:bg-white disabled:hover:text-slate-700"
          >
            {opt.key}. {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 需求整理完成卡片：深绿色高对比，与对话/问题卡片明显区分 */
function RequirementSummaryCard({
  json,
  confirmed,
  onConfirm,
}: {
  json: ChatRequirementJson;
  confirmed?: boolean;
  onConfirm?: () => void;
}) {
  const features = Array.isArray(json.core_features) ? json.core_features : [];
  const pages = Array.isArray(json.pages) ? json.pages : [];
  const [clicked, setClicked] = useState(false);
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-emerald-700 bg-emerald-600 p-3.5 text-white shadow-sm">
      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">✅ 需求已整理</p>
      {typeof json.goal === 'string' && json.goal && (
        <p className="text-sm leading-relaxed text-emerald-50">{json.goal}</p>
      )}
      {features.length > 0 && (
        <p className="mt-1.5 text-xs leading-relaxed text-emerald-100/90">
          功能：{features.join('、')}
        </p>
      )}
      {pages.length > 0 && (
        <p className="mt-0.5 text-xs leading-relaxed text-emerald-100/90">
          页面：{pages.join('、')}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-emerald-500/50 pt-3">
        <span className="text-xs leading-relaxed text-emerald-100/90">
          详细需求已整理到右侧「需求卡片」
        </span>
        {confirmed ? (
          <span className="shrink-0 rounded-lg bg-emerald-800/70 px-3.5 py-2 text-xs font-medium text-emerald-50">
            ✅ 已确认，正在规划开发步骤…
          </span>
        ) : (
          <button
            type="button"
            disabled={clicked}
            onClick={() => {
              setClicked(true);
              onConfirm?.();
            }}
            className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50 disabled:opacity-70"
          >
            {clicked ? '正在确认…' : '确认需求，开始规划 →'}
          </button>
        )}
      </div>
    </div>
  );
}

/** 消息气泡（前端设计说明书 3.2） */
export default function Message({
  message,
  disabled,
  onSelectOption,
  onConfirmRequirements,
  requirementsConfirmed,
}: MessageProps) {
  if (message.role === 'system') {
    return (
      <div className="my-2 text-center text-xs text-slate-400">{message.content}</div>
    );
  }

  const isUser = message.role === 'user';
  // 需求收敛消息：提取 JSON 渲染为整理卡片，正文只显示结束语/引导语
  const { json: reqJson, cleaned: reqCleaned } = extractRequirementJson(message.content);
  const hasReq = reqJson !== null;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[80%]">
        {/* 修复 P0-4：当用户消息带了元素上下文时，在气泡顶部渲染一行窄角标，
            让用户看见"这条消息是关于哪个元素的"，避免 DraggableChat 在另一处继续追问时
            上下文错位（用户以为在说别的，AI 实际在改这个元素）。
            只对元素上下文类型的消息渲染，普通用户消息不展示。 */}
        {isUser && message.metadata?.contextElement && (
          <div
            className="mb-1 flex items-center gap-1 rounded-br-xl rounded-tl-xl bg-brand/15 px-2 py-0.5 text-[11px] text-brand"
            title={`选择器：${message.metadata.contextElement.selector}`}
            data-testid="message-context-element-chip"
          >
            <span aria-hidden="true">🎯</span>
            <span className="font-medium">关于</span>
            <span className="truncate font-mono">
              {message.metadata.contextElement.description}
            </span>
          </div>
        )}
        <div
          className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
            isUser
              ? 'rounded-br-sm bg-brand text-white'
              : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'
          }`}
        >
          {!isUser && message.reasoning && <ThinkingBlock text={message.reasoning} />}
          {hasReq ? (
            <>
              {reqCleaned && <div className="whitespace-pre-wrap">{reqCleaned}</div>}
              <RequirementSummaryCard
                json={reqJson}
                confirmed={requirementsConfirmed}
                onConfirm={onConfirmRequirements}
              />
            </>
          ) : (
            (() => {
              // 支持多个「问题 + 选项」块（如需求审查一次问多个矛盾点），每个块一张卡片
              const blocks = extractQuestionBlocks(message.content);
              return blocks.length > 0 ? (
                blocks.map((b, i) => (
                  <QuestionCard
                    key={i}
                    question={b.question}
                    options={b.options}
                    disabled={disabled}
                    onSelect={onSelectOption}
                  />
                ))
              ) : (
                <div className="whitespace-pre-wrap">{message.content}</div>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
}
