import type { CSSProperties } from 'react';

export type MarqueeVariant = 'amber' | 'emerald' | 'slate';
export type MarqueeSpeed = 'slow' | 'normal' | 'fast';

interface MarqueeProps {
  /** 视觉风格（颜色调），与所在上下文主色对齐 */
  variant?: MarqueeVariant;
  /** 滚动速度：慢=12s / 中=7s / 快=4s */
  speed?: MarqueeSpeed;
  /** 跑马灯文案（默认「正在处理中」） */
  text?: string;
  /** 自定义外层 className（如控制 margin / padding / 高度） */
  className?: string;
  /** 自定义容器高度（默认 h-6）；数值越小越像细线 */
  height?: 'tight' | 'normal' | 'loose';
  /** 测试用：动画结束后回调（用于单测） */
  dataTestid?: string;
}

const VARIANT_STYLES: Record<
  MarqueeVariant,
  { track: string; text: string; dot: string }
> = {
  amber: {
    track: 'border-amber-300/70 bg-amber-50/80',
    text: 'text-amber-700',
    dot: 'text-amber-500',
  },
  emerald: {
    track: 'border-emerald-300/70 bg-emerald-50/80',
    text: 'text-emerald-700',
    dot: 'text-emerald-500',
  },
  slate: {
    track: 'border-slate-300/70 bg-slate-50/80',
    text: 'text-slate-600',
    dot: 'text-slate-400',
  },
};

const HEIGHT_CLASS: Record<NonNullable<MarqueeProps['height']>, string> = {
  tight: 'h-4 text-[10px]',
  normal: 'h-6 text-[11px]',
  loose: 'h-8 text-xs',
};

const SPEED_CLASS: Record<MarqueeSpeed, string> = {
  slow: 'fc-marquee-slow',
  normal: 'fc-marquee-normal',
  fast: 'fc-marquee-fast',
};

/**
 * 文字跑马灯：横向无缝循环滚动。
 *
 * 用于 AI 处理中（推理 / 执行 / 自动测试）的实时态：
 * - 复制两段相同文案向左滚动 50%，形成无缝循环
 * - 容器使用左右渐隐 mask，避免文字在边缘生硬截断
 * - 三档速度对应不同紧迫度（测试中=slow，主对话推理=normal，错误快恢复=fast）
 * - 三档颜色调对应不同上下文（amber=测试，emerald=主流程，slate=辅助）
 *
 * 注意：本组件为纯展示型，运行态由调用方控制（控制 isProcessing / autoTestRunning 的父级组件）。
 */
export default function Marquee({
  variant = 'slate',
  speed = 'normal',
  text = '正在处理中',
  className = '',
  height = 'normal',
  dataTestid,
}: MarqueeProps) {
  const palette = VARIANT_STYLES[variant];
  // 两段相同内容拼接，translateX(-50%) 时第二段恰好补在第一段原来的位置，实现无缝循环
  const segment = `${text}  •  `;

  // 左右渐隐 mask：边缘透明、中段实色，避免文字硬截
  const trackStyle: CSSProperties = {
    WebkitMaskImage:
      'linear-gradient(to right, transparent 0, black 6%, black 94%, transparent 100%)',
    maskImage:
      'linear-gradient(to right, transparent 0, black 6%, black 94%, transparent 100%)',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex w-full items-center overflow-hidden rounded-full border ${HEIGHT_CLASS[height]} ${palette.track} ${className}`.trim()}
      data-testid={dataTestid ?? 'fc-marquee'}
    >
      <div
        className={`flex w-full overflow-hidden ${SPEED_CLASS[speed]}`}
        style={trackStyle}
      >
        {/* 复制两份：一份滚出 50% 后第二份补上，无视觉跳跃 */}
        <span
          className={`flex shrink-0 whitespace-nowrap ${palette.text}`}
          aria-hidden="true"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={`a-${i}`}>{segment}</span>
          ))}
        </span>
        <span
          className={`flex shrink-0 whitespace-nowrap ${palette.text}`}
          aria-hidden="true"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={`b-${i}`}>{segment}</span>
          ))}
        </span>
      </div>
    </div>
  );
}