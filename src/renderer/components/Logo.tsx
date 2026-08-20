/**
 * FreeCoder 应用 Logo（内联 SVG，与 resources/icons 中的应用图标同款设计）：
 * 品牌蓝渐变圆角方块 + 白色代码尖括号 + 右上角星光。
 * 页面可能同时渲染多个实例（标题栏/弹窗/聊天欢迎页），渐变 id 用 useId 保证唯一。
 */
import { useId } from 'react';

export default function Logo({ size = 24, className }: { size?: number; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradId = `freecoder-logo-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="FreeCoder"
      role="img"
    >
      <defs>
        <linearGradient id={gradId} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5B9BE8" />
          <stop offset="1" stopColor="#2E6EB5" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill={`url(#${gradId})`} />
      <rect x="4" y="4" width="56" height="56" rx="14" stroke="#2E6EB5" strokeOpacity="0.35" />
      {/* 代码尖括号 </> */}
      <path
        d="M26 22 L17 32 L26 42"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M38 22 L47 32 L38 42"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M36.5 20 L29.5 44" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
      {/* 右上角星光 */}
      <path
        d="M48.5 10.5 C49 13 51 15 53.5 15.5 C51 16 49 18 48.5 20.5 C48 18 46 16 43.5 15.5 C46 15 48 13 48.5 10.5 Z"
        fill="#FFE08A"
      />
    </svg>
  );
}
