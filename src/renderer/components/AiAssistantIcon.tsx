/**
 * AI 助理图标（圆角方形 + 蓝→青→绿对角渐变 + 白色对话气泡 + 三点打字提示 + 右上 ✨ 闪光角标）。
 * 与 FreeCoder Logo（Logo.tsx）共用同一套渐变色（#0061B2 → #0096B5 → #4AC38E）+ useId 保证多实例渐变 id 不冲突。
 *
 * 设计说明：
 * - 方案 C（对话气泡 + 闪光），强调"沟通 / 互动"，比 🤖 emoji 更有品牌识别度
 * - withSparkle=false 时只保留气泡 + 三点（适合 ≤14px 的标题栏小图标，避免闪光角标糊掉）
 * - 默认 24px，可缩放到 14-48px 区间；14px 以下不建议再缩，会丢失细节
 */
import { useId } from 'react';

interface AiAssistantIconProps {
  size?: number;
  className?: string;
  /** 是否渲染右上角 ✨ 闪光角标（默认 true；小尺寸 14px 时建议关闭） */
  withSparkle?: boolean;
  /** 仅图标本体（不渲染背景方块），用于和文字同行时不需要方框包裹 */
  bare?: boolean;
}

export default function AiAssistantIcon({
  size = 24,
  className,
  withSparkle = true,
  bare = false,
}: AiAssistantIconProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradId = `fc-ai-icon-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AI 助理"
      role="img"
    >
      <defs>
        <linearGradient
          id={gradId}
          x1="0"
          y1="0"
          x2="64"
          y2="64"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0061B2" />
          <stop offset="0.5" stopColor="#0096B5" />
          <stop offset="1" stopColor="#4AC38E" />
        </linearGradient>
      </defs>
      {/* 圆角方形背景（bare=true 时不渲染，用于内联在文字行中） */}
      {!bare && <rect width="64" height="64" rx="14" fill={`url(#${gradId})`} />}
      {/* 主对话气泡：左侧尾巴，主体居中偏左下，给右上角闪光留位置 */}
      <path
        d="M16 20h28a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H26l-6 6v-6h-4a6 6 0 0 1-6-6V26a6 6 0 0 1 6-6z"
        fill="#fff"
      />
      {/* 打字三点（用渐变填充，前景色呼应主题） */}
      <circle cx="22" cy="32" r="2.2" fill={bare ? '#fff' : `url(#${gradId})`} />
      <circle cx="30" cy="32" r="2.2" fill={bare ? '#fff' : `url(#${gradId})`} />
      <circle cx="38" cy="32" r="2.2" fill={bare ? '#fff' : `url(#${gradId})`} />
      {/* ✨ 闪光角标：右上角，五角星变体；暖黄色与冷蓝绿渐变形成对比 */}
      {withSparkle && (
        <path
          d="M50 10l1.5 3.5 3.5 1.5-3.5 1.5L50 20l-1.5-3.5L45 15l3.5-1.5L50 10z"
          fill="#FFD86B"
        />
      )}
    </svg>
  );
}