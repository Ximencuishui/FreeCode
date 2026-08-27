/**
 * FreeCoder 应用 Logo（内联 SVG，与 public/favicon.png 同款新品牌设计）：
 * 蓝→青→绿对角渐变的圆角方块 + 白色字母 F + 右侧层叠小块（底部右下角）。
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
        <linearGradient id={gradId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0061B2" />
          <stop offset="0.5" stopColor="#0096B5" />
          <stop offset="1" stopColor="#4AC38E" />
        </linearGradient>
      </defs>
      {/* 右侧层叠小块（底层，露出主图块右/下边缘） */}
      <rect x="49" y="3.5" width="14.5" height="58.5" rx="6.5" fill={`url(#${gradId})`} />
      {/* 主图块 */}
      <rect x="0.5" y="3.5" width="56" height="56" rx="13" fill={`url(#${gradId})`} />
      {/* 白色字母 F（竖杆 + 上横 + 中横，圆角） */}
      <g fill="#E0E0DC">
        <rect x="15" y="12" width="9" height="38" rx="4.5" />
        <rect x="15" y="12" width="25" height="8.5" rx="4.25" />
        <rect x="15" y="28" width="22" height="9.5" rx="4.75" />
      </g>
    </svg>
  );
}
