import { useEffect, useRef, useState } from 'react';
import { useChatStore, type ResumeGuide, type ResumeAction } from '../../store/chat';
import Message from './Message';
import MessageInput from './MessageInput';
import ResumeCard from './ResumeCard';
import Logo from '../Logo';

interface ChatContainerProps {
  /** 需求收敛卡片的 CTA：确认需求并进入版本规划（由 App 提供） */
  onConfirmRequirements?: () => void;
  /** 重新进入中途项目的进度引导（为 null 时不显示） */
  resumeGuide?: ResumeGuide | null;
  /** 进度引导的动作回调 */
  onResumeAction?: (action: ResumeAction) => void;
  /** 一键自动测试进行中：透传给 ResumeCard 显示"测试中"实时态 */
  autoTestRunning?: boolean;
  /** 自动测试最近一条进度文本 */
  autoTestLatestProgress?: string | null;
}

/** 对话容器：进度引导卡 + 消息流 + 输入区（前端设计说明书 3.2 / 2.1 主工作区） */
export default function ChatContainer({
  onConfirmRequirements,
  resumeGuide,
  onResumeAction,
  autoTestRunning,
  autoTestLatestProgress,
}: ChatContainerProps) {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const thinkingText = useChatStore((s) => s.thinkingText);
  const projectStatus = useChatStore((s) => s.projectStatus);
  const devProgress = useChatStore((s) => s.devProgress);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopTask = useChatStore((s) => s.stopTask);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showDevLog, setShowDevLog] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isProcessing, devProgress]);

  const handleSelectOption = (option: { label: string }) => {
    void sendMessage(option.label);
  };

  const suggestions = [
    '💡 我想做一个记账工具，记录日常收支',
    '📝 帮我做一个待办清单应用',
    '🌐 我想做一个个人博客网站',
  ];

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex min-h-full flex-col items-center justify-center px-4 py-10 text-center">
            <Logo size={56} className="mb-4" />
            <p className="text-lg font-medium text-slate-700">您好！我是您的产品助理</p>
            <p className="mt-1.5 text-sm text-slate-400">
              说出您的想法，我来帮您把它变成可用的软件
            </p>
            <div className="mt-6 flex w-full max-w-md flex-col gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void sendMessage(s)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left text-sm text-slate-600 transition-colors hover:border-brand hover:bg-brand/5 hover:text-slate-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Message
            key={m.id}
            message={m}
            disabled={isProcessing}
            onSelectOption={handleSelectOption}
            onConfirmRequirements={onConfirmRequirements}
            requirementsConfirmed={projectStatus !== 'draft'}
          />
        ))}
        {/* 重新进入中途项目：AI 助理汇报进度 + 继续下一步（作为对话流最新一条，随滚动停靠） */}
        {resumeGuide && onResumeAction && (
          <ResumeCard
            guide={resumeGuide}
            onAction={onResumeAction}
            autoTestRunning={autoTestRunning}
            autoTestLatestProgress={autoTestLatestProgress}
          />
        )}
        {isProcessing && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-2.5 text-xs leading-relaxed text-slate-500">
              {thinkingText ? (
                <div className="max-h-52 overflow-y-auto whitespace-pre-wrap">{thinkingText}</div>
              ) : (
                <div className="text-sm text-slate-400">正在思考…</div>
              )}
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-amber-200/70 pt-2">
                <span className="text-[11px] text-amber-600/80">
                  {thinkingText ? 'AI 正在推理中…' : 'AI 正在执行中…'}
                </span>
                <button
                  type="button"
                  onClick={() => void stopTask()}
                  className="shrink-0 rounded border border-amber-300 bg-white/70 px-2 py-0.5 text-[11px] text-amber-700 transition-colors hover:bg-amber-100"
                >
                  ⏹ 停止
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 开发进度报告（工具调用流：📝 写入文件 / 🛠 运行命令 / 🧪 测试）——对话流最底部 */}
        {devProgress.length > 0 && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-xs leading-relaxed text-slate-600">
              <p className="mb-1 font-medium text-emerald-700">📦 开发进度</p>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap">
                {devProgress.join('\n')}
              </div>
            </div>
          </div>
        )}
        {/* 开发团队怎么说：查看 DSH 原始对话（默认收起，不干扰主对话；可随时展开/关闭） */}
        {devProgress.length > 0 && (
          <div className="flex justify-start">
            <div className="max-w-[85%] overflow-hidden rounded-xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600">
              <button
                type="button"
                onClick={() => setShowDevLog((v) => !v)}
                className="flex w-full items-center gap-1.5 py-0.5 text-left text-xs font-medium text-slate-700 transition-colors hover:text-brand"
              >
                💡 开发团队怎么说？
                <span className="ml-auto text-slate-400">{showDevLog ? '收起 ▴' : '展开 ▾'}</span>
              </button>
              {showDevLog && (
                <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-slate-100 pt-1.5 font-mono text-[11px] text-slate-500">
                  {devProgress.map((l) => `[开发员] ${l}`).join('\n')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 p-3">
        {/* 执行中不禁用输入：用户可随时插话调整需求（会中断当前任务） */}
        <MessageInput
          disabled={false}
          placeholder={
            isProcessing
              ? 'AI 正在执行… 输入新消息将中断当前任务，重新开始（可随时调整需求）'
              : '输入消息，Enter 发送…'
          }
          onSend={(text) => void sendMessage(text)}
        />
      </div>
    </div>
  );
}
