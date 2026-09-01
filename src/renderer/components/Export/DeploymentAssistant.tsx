import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat';

/**
 * AI 部署助手（v3.2，PRD 2.4.4）。
 *
 * 对话状态机：IDENTIFY（识别）→ GUIDE（引导）→ FALLBACK（兜底）→ MILESTONE（里程碑）。
 * 核心原则："代替用户思考"而非"教用户思考"。
 *
 * 当前实现是 UI + 状态机的最小骨架：
 * - 助手发言通过 chatStore.pushMessage 注入主聊天流（与 AI 助理共享上下文）；
 * - 三态之间的转换靠触发器 + 用户手动确认；
 * - 后端能力（一键启动真实 dev server / 智能打包 / 部署引导）尚未接入，
 *   所以真实自动降级链路在占位状态；触发器用占位定时器演示主动介入时机。
 */
type AssistantMode = 'identify' | 'guide' | 'fallback';

const MODE_META: Record<AssistantMode, { icon: string; title: string; tag: string; tone: string }> = {
  identify: {
    icon: '🧭',
    title: '我来帮你选一条路',
    tag: '识别',
    tone: '我比你更知道该走哪条路',
  },
  guide: {
    icon: '🪜',
    title: '你看着就行，我来操作',
    tag: '引导',
    tone: '每一步我都会先告诉你，等你点头',
  },
  fallback: {
    icon: '🤝',
    title: '这一步太费劲了，我直接帮你搞定',
    tag: '兜底',
    tone: '你已经搞不定了吧，交给我',
  },
};

interface DeploymentAssistantProps {
  onClose: () => void;
  /** 兜底完成后调用（让 DeployPanel 关闭助手浮层并回到 home） */
  onSuccess: () => void;
}

export default function DeploymentAssistant({ onClose, onSuccess }: DeploymentAssistantProps) {
  const [mode, setMode] = useState<AssistantMode>('identify');
  const pushMessage = useChatStore((s) => s.pushMessage);
  const greetedRef = useRef(false);

  // 进入助手 → 主动推送开场白到聊天流（PRD 触发时机 #1：用户打开部署向导）
  useEffect(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    pushMessage({
      role: 'assistant',
      content:
        '[部署助手] 你好，我是 FreeCoder 的部署助手 🚀\n\n' +
        '我来帮你把应用真正"跑起来"。你可以随时问我"卡住了怎么办"，我会立刻介入。',
      timestamp: new Date().toISOString(),
    });
  }, [pushMessage]);

  // PRD 触发时机 #2：用户在选择路径时停留 >5 秒（演示用，真实环境由父组件触发）
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mode === 'identify') {
        pushMessage({
          role: 'assistant',
          content:
            '[部署助手] 💡 看起来你在纠结选哪条路。根据你的环境，我推荐「一键启动」——' +
            '不用导出任何东西，应用立刻就能跑。',
          timestamp: new Date().toISOString(),
        });
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [mode, pushMessage]);

  const handleModeSwitch = (next: AssistantMode) => {
    setMode(next);
    const meta = MODE_META[next];
    pushMessage({
      role: 'assistant',
      content: `[部署助手] 切换到【${meta.tag}】模式 — ${meta.tone}`,
      timestamp: new Date().toISOString(),
    });
  };

  const handleTakeOver = () => {
    // 兜底接管：直接调 onSuccess（真实实现里会跑完整个部署流程）
    pushMessage({
      role: 'assistant',
      content:
        '[部署助手] 🤝 我来替你完成这一步。你先休息一下，我搞定了叫你。\n\n' +
        '完成后我会推送一个项目里程碑卡 🎉',
      timestamp: new Date().toISOString(),
    });
    onSuccess();
  };

  const meta = MODE_META[mode];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div
        className="m-4 flex w-full max-w-md flex-col rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">{meta.icon}</span>
              <span className="text-sm font-semibold text-slate-800">{meta.title}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                {meta.tag}
              </span>
              <span className="text-xs text-slate-400">{meta.tone}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="关闭助手"
          >
            ✕
          </button>
        </div>

        {/* 三态切换（演示用，真实环境由触发器自动切换） */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(Object.keys(MODE_META) as AssistantMode[]).map((m) => {
            const mMeta = MODE_META[m];
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => handleModeSwitch(m)}
                className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <div>{mMeta.icon}</div>
                <div className="mt-0.5">{mMeta.tag}</div>
              </button>
            );
          })}
        </div>

        {/* 当前态的具体动作 */}
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          {mode === 'identify' && (
            <>
              <div className="font-medium text-slate-700">🧭 我正在分析…</div>
              <div className="mt-1">检测系统环境 → 选择部署路径 → 推荐最优方案</div>
            </>
          )}
          {mode === 'guide' && (
            <>
              <div className="font-medium text-slate-700">🪜 下一步操作</div>
              <div className="mt-1">正在准备依赖…这一步会比较慢，你可以先去干别的</div>
              <div className="mt-2 text-slate-400">预计剩余：45 秒</div>
            </>
          )}
          {mode === 'fallback' && (
            <>
              <div className="font-medium text-slate-700">🤝 我来接管</div>
              <div className="mt-1">你不需要做任何操作，我会自动跑完整个流程</div>
            </>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="mt-4 flex gap-2">
          {mode === 'fallback' ? (
            <button
              type="button"
              onClick={handleTakeOver}
              className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              🤝 接管操作
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                暂时不需要
              </button>
              <button
                type="button"
                onClick={() =>
                  handleModeSwitch(mode === 'identify' ? 'guide' : 'fallback')
                }
                className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
              >
                {mode === 'identify' ? '接受推荐' : '帮我接管'}
              </button>
            </>
          )}
        </div>

        {/* 降级链提示（PRD 2.4.5） */}
        <div className="mt-3 text-center text-[10px] text-slate-400">
          降级链：一键启动 → 智能打包 → 部署指引 → 高级导出
        </div>
      </div>
    </div>
  );
}