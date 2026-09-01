/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#4A90D9',
          hover: '#3A7BC8',
        },
      },
      // 进入动画：测试完成态的 verdict 卡片从下方轻微淡入
      // 设计意图：呼应《产品需求文档 v3.0》§1.3「正向反馈」+《前端设计说明书》§1.2「成就感」
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // 徽章弹跳：verdict 徽章轻微 scale 起伏，强化"测试完成"的完成感
        badgePop: {
          '0%': { transform: 'scale(0.85)' },
          '60%': { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 200ms ease-out both',
        badgePop: 'badgePop 500ms ease-out both',
      },
    },
  },
  plugins: [],
};