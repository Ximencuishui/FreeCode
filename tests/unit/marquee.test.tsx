/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import Marquee from '../../src/renderer/components/Marquee';

describe('Marquee（文字跑马灯）', () => {
  it('默认渲染：包含 fc-marquee testid 和基础结构', () => {
    render(<Marquee />);
    const node = screen.getByTestId('fc-marquee');
    expect(node).toBeTruthy();
    expect(node.getAttribute('role')).toBe('status');
    expect(node.getAttribute('aria-live')).toBe('polite');
  });

  it('复制两段文案：保证无缝循环（key 为 a-/b- 两组）', () => {
    render(<Marquee text="正在处理" />);
    const node = screen.getByTestId('fc-marquee');
    // 两段隐藏文案均渲染；总段落数 = 6*2 = 12
    expect(node.textContent?.includes('正在处理')).toBe(true);
    const segments = node.querySelectorAll('span[aria-hidden="true"] > span');
    expect(segments.length).toBe(12);
  });

  it('支持自定义 text / speed / variant / height / dataTestid', () => {
    render(
      <Marquee
        text="🧪 测试中"
        speed="slow"
        variant="amber"
        height="tight"
        dataTestid="custom-marquee"
      />,
    );
    expect(screen.getByTestId('custom-marquee')).toBeTruthy();
    expect(screen.getByTestId('custom-marquee').textContent?.includes('🧪 测试中')).toBe(true);
  });

  it('尊重 prefers-reduced-motion：动画类仍附加，由 CSS media query 兜底停止', () => {
    render(<Marquee speed="fast" dataTestid="reduced-motion" />);
    // 只是确保类名挂上了；实际 media query 由浏览器层处理
    const wrapper = screen.getByTestId('reduced-motion').querySelector('.fc-marquee-fast');
    expect(wrapper).toBeTruthy();
  });
});