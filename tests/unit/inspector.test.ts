import { describeElement, friendlyElementName } from '../../src/main/preview/inspector';
import type { ElementInfo } from '../../src/shared/types/preview';

const element: ElementInfo = {
  tag: 'h1',
  id: '',
  content: '欢迎来到 FreeCoder',
  selector: 'h1.title',
  styles: {
    color: '#1A2B3C',
    fontSize: '32px',
    fontWeight: '700',
    backgroundColor: 'rgba(0, 0, 0, 0)',
  },
  position: { x: 10, y: 20, width: 300, height: 40 },
};

describe('元素友好化（WP-15/16）', () => {
  it('friendlyElementName：标签映射为中文名', () => {
    expect(friendlyElementName(element)).toBe('主标题');
    expect(friendlyElementName({ ...element, tag: 'button' })).toBe('按钮');
    expect(friendlyElementName({ ...element, tag: 'div' })).toBe('元素');
    expect(friendlyElementName({ ...element, id: 'title' })).toBe('主标题（title）');
  });

  it('describeElement：描述包含名称、内容与样式摘要', () => {
    const info = describeElement(element);
    expect(info?.name).toBe('主标题');
    expect(info?.description).toContain('主标题');
    expect(info?.description).toContain('欢迎来到 FreeCoder');
    expect(info?.description).toContain('#1A2B3C');
    expect(info?.description).toContain('32px');
    expect(info?.description).toContain('700');
    // 透明背景不列出
    expect(info?.description).not.toContain('rgba(0, 0, 0, 0)');
  });

  it('describeElement：suggestedActions 提供常见调整', () => {
    const info = describeElement(element);
    const actions = info?.suggestedActions.map((a) => a.action) ?? [];
    expect(actions).toContain('change-color');
    expect(actions).toContain('change-size');
    expect(actions).toContain('edit-text');
  });
});
