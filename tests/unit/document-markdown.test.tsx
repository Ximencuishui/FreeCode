/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import DocumentMarkdown from '../../src/renderer/components/Documents/DocumentMarkdown';

/**
 * v3.2.2 P1-13 + P1-14：DocumentMarkdown 链接降级 + 图片放大单测。
 *
 * P1-13：非 http(s)/mailto 链接（file:// / 内部锚点 / 相对路径）降级为 <span>，
 *       title 提示协议类型。http/https 仍渲染为可点击 <a>。
 * P1-14：内嵌图片渲染为可点击 <button>，点击 → 全屏弹层（<img> + Esc 关闭）。
 */
describe('DocumentMarkdown 链接降级（P1-13）', () => {
  it('https 链接渲染为可点击 <a target="_blank">', () => {
    const { container } = render(
      <DocumentMarkdown content={'看 [官网](https://example.com)'} />,
    );
    const a = container.querySelector('a[href="https://example.com"]') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noreferrer');
  });

  it('mailto 链接渲染为可点击 <a>', () => {
    const { container } = render(
      <DocumentMarkdown content={'联系 [support](mailto:hi@example.com)'} />,
    );
    const a = container.querySelector('a[href="mailto:hi@example.com"]') as HTMLAnchorElement;
    expect(a).toBeTruthy();
  });

  it('file:// 链接降级为 <span> + title 提示协议', () => {
    const { container } = render(
      <DocumentMarkdown content={'本地 [文档](/Users/x/a.md)'} />,
    );
    const span = container.querySelector('span[title]') as HTMLSpanElement;
    expect(span).toBeTruthy();
    // 相对路径（以字母数字开头）应被识别为「相对路径（项目内文件）」
    expect(span.title).toMatch(/相对路径|内部|当前文档预览暂不支持打开/);
    // 降级样式（text-slate-500 + dotted underline）
    expect(span.className).toContain('text-slate-500');
    expect(span.className).toContain('decoration-dotted');
  });

  it('javascript: 协议降级为 <span> + 提示 javascript 协议', () => {
    const { container } = render(
      <DocumentMarkdown content={'[点我](javascript:alert(1))'} />,
    );
    const span = container.querySelector('span[title]') as HTMLSpanElement;
    expect(span).toBeTruthy();
    expect(span.title).toMatch(/javascript/);
    // 安全：不能渲染为 <a>
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('相对路径（./foo.md）降级为 <span> + 提示内部链接', () => {
    const { container } = render(
      <DocumentMarkdown content={'[同级](./foo.md)'} />,
    );
    const span = container.querySelector('span[title]') as HTMLSpanElement;
    expect(span).toBeTruthy();
    expect(span.title).toMatch(/内部锚点|相对路径/);
  });
});

describe('DocumentMarkdown 图片放大（P1-14）', () => {
  it('内嵌图片渲染为可点击 <button> + title="点击查看大图"', () => {
    const { container } = render(
      <DocumentMarkdown content={'![预览图](file:///tmp/img.png)'} />,
    );
    const btn = container.querySelector('button[title="点击查看大图"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    // alt 文本应该作为按钮 label 出现
    expect(btn.textContent).toContain('预览图');
    // 没有立即渲染 <img>（全屏弹层未打开）
    expect(container.querySelector('img')).toBeNull();
  });

  it('点击图片按钮 → 渲染全屏弹层 + <img src>', () => {
    const { container } = render(
      <DocumentMarkdown content={'![预览图](file:///tmp/img.png)'} />,
    );
    const btn = container.querySelector('button[title="点击查看大图"]') as HTMLButtonElement;
    fireEvent.click(btn);

    // 全屏弹层：role=dialog + aria-modal=true
    const dialog = screen.getByRole('dialog') as HTMLDivElement;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('预览图');

    // <img> 渲染
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('file:///tmp/img.png');
    expect(img.alt).toBe('预览图');
  });

  it('ESC 关闭全屏弹层', () => {
    const { container } = render(
      <DocumentMarkdown content={'![预览图](file:///tmp/img.png)'} />,
    );
    fireEvent.click(container.querySelector('button[title="点击查看大图"]') as HTMLElement);
    expect(container.querySelector('img')).toBeTruthy();

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    // 弹层消失
    expect(container.querySelector('img')).toBeNull();
  });

  it('点击遮罩关闭全屏弹层（onClick on dialog div）', () => {
    const { container } = render(
      <DocumentMarkdown content={'![预览图](file:///tmp/img.png)'} />,
    );
    fireEvent.click(container.querySelector('button[title="点击查看大图"]') as HTMLElement);
    const dialog = screen.getByRole('dialog') as HTMLDivElement;
    fireEvent.click(dialog);
    expect(container.querySelector('img')).toBeNull();
  });

  it('点击关闭按钮（✕ 关闭（Esc））也能关闭弹层', () => {
    const { container } = render(
      <DocumentMarkdown content={'![预览图](file:///tmp/img.png)'} />,
    );
    fireEvent.click(container.querySelector('button[title="点击查看大图"]') as HTMLElement);
    const closeBtn = screen.getByLabelText('关闭预览') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(container.querySelector('img')).toBeNull();
  });

  it('点击图片内层 div 不关闭（stopPropagation on inner wrapper）', () => {
    const { container } = render(
      <DocumentMarkdown content={'![预览图](file:///tmp/img.png)'} />,
    );
    fireEvent.click(container.querySelector('button[title="点击查看大图"]') as HTMLElement);
    expect(container.querySelector('img')).toBeTruthy();

    // 内层 <img> 的父 div 有 onClick stopPropagation，点击内层 div 不应关闭
    const innerDiv = container.querySelector('[role="dialog"] > div') as HTMLDivElement;
    fireEvent.click(innerDiv);
    expect(container.querySelector('img')).toBeTruthy();
  });
});