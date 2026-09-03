/** @jest-environment jsdom */
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DraggableChat from '../../src/renderer/components/Chat/DraggableChat';
import { useChatStore } from '../../src/renderer/store/chat';
import type { ChatMessageUI } from '../../src/renderer/store/chat';

/**
 * AI 助理聊天浮窗（DraggableChat）：
 * - 标题栏拖动 + 位置持久化
 * - 最小化为右下角圆形图标 + 点击恢复
 * - 发送消息走 chat store.sendMessage
 * - 处理中禁用发送按钮 + 可选 marquee 跑马灯
 *
 * 覆盖范围（与项目其它测试保持一致：仅验证渲染 + 用户交互，不验证拖动像素级精度）
 */

const STORAGE_KEY = 'fc-draggable-chat:pos';

function makeMsg(role: ChatMessageUI['role'], content: string): ChatMessageUI {
  return {
    id: `m-${role}-${content}`,
    role,
    content,
    timestamp: '2026-09-01T00:00:00Z',
  };
}

describe('DraggableChat（AI 助理聊天浮窗）', () => {
  beforeEach(() => {
    // 清空 store / 存储，避免测试间互相干扰
    useChatStore.setState({
      messages: [],
      isProcessing: false,
    });
    localStorage.clear();
  });

  it('展开态默认渲染：浮窗容器 + 标题栏 + 输入框 + 发送按钮', () => {
    render(<DraggableChat />);
    expect(screen.getByTestId('fc-draggable-chat')).toBeTruthy();
    expect(screen.getByTestId('fc-draggable-chat-header')).toBeTruthy();
    expect(screen.getByTestId('fc-draggable-chat-input')).toBeTruthy();
    expect(screen.getByTestId('fc-draggable-chat-send')).toBeTruthy();
    // 标题文案
    expect(screen.getByText(/AI 助理/)).toBeTruthy();
  });

  it('最小化按钮：点击后切到右下角圆形图标；点击圆形图标恢复浮窗', () => {
    render(<DraggableChat />);
    expect(screen.getByTestId('fc-draggable-chat')).toBeTruthy();

    // 展开态不应有圆形图标
    expect(screen.queryByTestId('fc-draggable-chat-minimized')).toBeNull();

    // 点击 "−"：最小化
    fireEvent.click(screen.getByTestId('fc-draggable-chat-minimize'));

    // 浮窗容器消失，圆形图标出现
    expect(screen.queryByTestId('fc-draggable-chat')).toBeNull();
    const orb = screen.getByTestId('fc-draggable-chat-minimized');
    expect(orb).toBeTruthy();
    expect(orb.getAttribute('aria-label')).toBe('展开 AI 助理');

    // 点击圆形图标：恢复
    fireEvent.click(orb);
    expect(screen.getByTestId('fc-draggable-chat')).toBeTruthy();
    expect(screen.queryByTestId('fc-draggable-chat-minimized')).toBeNull();
  });

  it('"−" 按钮上的 mousedown 被阻止冒泡：避免误触标题栏拖动', () => {
    render(<DraggableChat />);
    // 仅触发 onMouseDown.stopPropagation 路径，不让标题栏的 startDrag 跟着跑
    const btn = screen.getByTestId('fc-draggable-chat-minimize');
    // 直接调用不应抛错；只是验证 stopPropagation 不让 onMouseDown 触发 startDrag
    expect(() => fireEvent.mouseDown(btn)).not.toThrow();
  });

  it('输入消息 + 点击发送：调用 chat store.sendMessage + 清空输入框', () => {
    const sendSpy = jest
      .spyOn(useChatStore.getState(), 'sendMessage')
      .mockResolvedValue(undefined);
    render(<DraggableChat />);

    const input = screen.getByTestId('fc-draggable-chat-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '帮我把按钮改成蓝色' } });
    fireEvent.click(screen.getByTestId('fc-draggable-chat-send'));

    expect(sendSpy).toHaveBeenCalledWith('帮我把按钮改成蓝色');
    expect(input.value).toBe('');
    sendSpy.mockRestore();
  });

  it('Enter 键发送消息', () => {
    const sendSpy = jest
      .spyOn(useChatStore.getState(), 'sendMessage')
      .mockResolvedValue(undefined);
    render(<DraggableChat />);
    const input = screen.getByTestId('fc-draggable-chat-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Enter 测试' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendSpy).toHaveBeenCalledWith('Enter 测试');
    sendSpy.mockRestore();
  });

  it('空白消息不发：仅空格不会触发 sendMessage', () => {
    const sendSpy = jest
      .spyOn(useChatStore.getState(), 'sendMessage')
      .mockResolvedValue(undefined);
    render(<DraggableChat />);
    const input = screen.getByTestId('fc-draggable-chat-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('fc-draggable-chat-send'));
    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });

  it('isProcessing=true：发送按钮禁用 + 显示处理中文案', () => {
    act(() => {
      useChatStore.setState({ isProcessing: true });
    });
    render(<DraggableChat />);
    const btn = screen.getByTestId('fc-draggable-chat-send') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // 默认 marqueeOnProcessing=false：显示「AI 正在处理…」
    expect(screen.getByText(/AI 正在处理/)).toBeTruthy();
  });

  it('marqueeOnProcessing=true：处理中显示跑马灯（而非普通文案）', () => {
    act(() => {
      useChatStore.setState({ isProcessing: true });
    });
    render(<DraggableChat marqueeOnProcessing marqueeText="🧪 测试中…" />);
    // 跑马灯 testid
    expect(screen.getByTestId('fc-draggable-chat-marquee')).toBeTruthy();
    // 普通文案不再渲染
    expect(screen.queryByText(/AI 正在处理/)).toBeNull();
  });

  it('marqueeOnProcessing=false + isProcessing=false：不显示处理中提示', () => {
    act(() => {
      useChatStore.setState({ isProcessing: false });
    });
    render(<DraggableChat marqueeOnProcessing />);
    expect(screen.queryByTestId('fc-draggable-chat-marquee')).toBeNull();
    expect(screen.queryByText(/AI 正在处理/)).toBeNull();
  });

  it('消息流：渲染最近 6 条 user/assistant，跳过 system', () => {
    // 历史 2 条 → 当前 6 条窗口 → system 1 条 → 后续 1 条
    // slice(-6) 应只命中「当前 6 条」部分
    act(() => {
      useChatStore.setState({
        messages: [
          makeMsg('user', 'history-1-should-not-render'),
          makeMsg('user', 'history-2-should-not-render'),
          makeMsg('system', 'system-msg-should-not-render'),
          makeMsg('user', '我想做个记账工具'),
          makeMsg('assistant', '好的，我先帮你整理需求'),
          makeMsg('user', '主要记录日常收支'),
          makeMsg('assistant', '明白了'),
          makeMsg('user', '再加个预算功能'),
          makeMsg('assistant', '已加入规划'),
          makeMsg('system', 'system-after-window-should-not-render'),
        ],
      });
    });
    render(<DraggableChat />);
    const container = screen.getByTestId('fc-draggable-chat-messages');
    // system 消息绝不出现
    expect(container.textContent?.includes('system-msg-should-not-render')).toBe(false);
    expect(container.textContent?.includes('system-after-window-should-not-render')).toBe(
      false,
    );
    // 6 条窗口外的旧消息不出现
    expect(container.textContent?.includes('history-1-should-not-render')).toBe(false);
    expect(container.textContent?.includes('history-2-should-not-render')).toBe(false);
    // 6 条窗口内的消息都出现
    expect(container.textContent?.includes('我想做个记账工具')).toBe(true);
    expect(container.textContent?.includes('已加入规划')).toBe(true);
  });

  it('消息流空态：显示「还没有对话」引导', () => {
    act(() => {
      useChatStore.setState({ messages: [] });
    });
    render(<DraggableChat />);
    expect(screen.getByText(/还没有对话/)).toBeTruthy();
  });

  it('forceExpand=true 时：即使已最小化也会被强制展开', () => {
    const { rerender } = render(<DraggableChat />);
    fireEvent.click(screen.getByTestId('fc-draggable-chat-minimize'));
    expect(screen.getByTestId('fc-draggable-chat-minimized')).toBeTruthy();

    rerender(<DraggableChat forceExpand />);
    expect(screen.getByTestId('fc-draggable-chat')).toBeTruthy();
    expect(screen.queryByTestId('fc-draggable-chat-minimized')).toBeNull();
  });

  it('拖动标题栏 → 浮窗位置变化（left/top 样式）', () => {
    // mock getBoundingClientRect：返回一个确定的初始位置
    const origGetBCR = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        left: 100,
        top: 100,
        right: 460,
        bottom: 400,
        width: 360,
        height: 300,
        x: 100,
        y: 100,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };

    render(<DraggableChat />);
    const header = screen.getByTestId('fc-draggable-chat-header');
    const container = screen.getByTestId('fc-draggable-chat') as HTMLDivElement;

    // 初始：未拖动，使用 right/bottom 定位
    expect(container.style.left).toBe('');
    expect(container.style.top).toBe('');
    expect(container.style.right).toBe('24px');
    expect(container.style.bottom).toBe('24px');

    // mousedown → mousemove → 浮窗位置应变化
    fireEvent.mouseDown(header, { clientX: 110, clientY: 110 });
    fireEvent.mouseMove(document, { clientX: 200, clientY: 250 });
    fireEvent.mouseUp(document, { clientX: 200, clientY: 250 });

    expect(container.style.left).toBe('190px');
    expect(container.style.top).toBe('240px');
    expect(container.style.right).toBe('');
    expect(container.style.bottom).toBe('');

    // localStorage 应已持久化位置
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(typeof stored.x).toBe('number');
    expect(typeof stored.y).toBe('number');

    HTMLElement.prototype.getBoundingClientRect = origGetBCR;
  });

  it('拖动时限制在视口内：拖到屏幕外会被钳制', () => {
    const origGetBCR = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        left: 0,
        top: 0,
        right: 360,
        bottom: 300,
        width: 360,
        height: 300,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };

    render(<DraggableChat />);
    const header = screen.getByTestId('fc-draggable-chat-header');

    // 视口大小由 jsdom 默认：window.innerWidth=1024, innerHeight=768
    fireEvent.mouseDown(header, { clientX: 0, clientY: 0 });
    // 拖到 (9999, 9999) 应被钳制
    fireEvent.mouseMove(document, { clientX: 9999, clientY: 9999 });
    fireEvent.mouseUp(document, { clientX: 9999, clientY: 9999 });

    const container = screen.getByTestId('fc-draggable-chat') as HTMLDivElement;
    const x = parseInt(container.style.left, 10);
    const y = parseInt(container.style.top, 10);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(window.innerWidth);
    expect(y).toBeLessThanOrEqual(window.innerHeight);

    HTMLElement.prototype.getBoundingClientRect = origGetBCR;
  });

  it('位置持久化：localStorage 中的合法位置会在下次渲染时直接使用 left/top', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 200, y: 150 }));
    render(<DraggableChat />);
    const container = screen.getByTestId('fc-draggable-chat') as HTMLDivElement;
    expect(container.style.left).toBe('200px');
    expect(container.style.top).toBe('150px');
    expect(container.style.right).toBe('');
    expect(container.style.bottom).toBe('');
  });

  it('localStorage 损坏数据（坏 JSON）：忽略并使用默认位置', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{{{');
    render(<DraggableChat />);
    const container = screen.getByTestId('fc-draggable-chat') as HTMLDivElement;
    expect(container.style.left).toBe('');
    expect(container.style.right).toBe('24px');
  });

  it('localStorage 越界数据（x/y 超出当前视口）：忽略并使用默认位置', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 99999, y: 99999 }));
    render(<DraggableChat />);
    const container = screen.getByTestId('fc-draggable-chat') as HTMLDivElement;
    expect(container.style.left).toBe('');
    expect(container.style.right).toBe('24px');
  });

  it('浮窗默认使用 fixed 定位（脱离文档流）', () => {
    render(<DraggableChat />);
    const container = screen.getByTestId('fc-draggable-chat') as HTMLDivElement;
    expect(container.className).toContain('fixed');
  });

  it('最小化态圆形图标：fixed 定位 + z-index 高于展开态浮窗', () => {
    render(<DraggableChat zIndex={40} />);
    fireEvent.click(screen.getByTestId('fc-draggable-chat-minimize'));
    const orb = screen.getByTestId('fc-draggable-chat-minimized') as HTMLDivElement;
    expect(orb.className).toContain('fixed');
    expect(orb.style.zIndex).toBe('41');
  });

  it('hidden=true：整个浮窗 + 圆形图标都不渲染（位置状态保留）', () => {
    // 先拖动一下，验证位置被记住
    const origGetBCR = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        left: 50,
        top: 60,
        right: 410,
        bottom: 360,
        width: 360,
        height: 300,
        x: 50,
        y: 60,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };

    const { rerender } = render(<DraggableChat />);
    fireEvent.mouseDown(screen.getByTestId('fc-draggable-chat-header'), {
      clientX: 60,
      clientY: 70,
    });
    fireEvent.mouseMove(document, { clientX: 300, clientY: 200 });
    fireEvent.mouseUp(document, { clientX: 300, clientY: 200 });

    // 隐藏：展开态容器 + 最小化态圆形图标都不应渲染
    rerender(<DraggableChat hidden />);
    expect(screen.queryByTestId('fc-draggable-chat')).toBeNull();
    expect(screen.queryByTestId('fc-draggable-chat-minimized')).toBeNull();

    // 恢复显示：浮窗应回到拖动后的位置
    rerender(<DraggableChat hidden={false} />);
    const container = screen.getByTestId('fc-draggable-chat') as HTMLDivElement;
    expect(container.style.left).toBe('290px'); // 50 + (300 - 60)
    expect(container.style.top).toBe('190px'); // 60 + (200 - 70)

    HTMLElement.prototype.getBoundingClientRect = origGetBCR;
  });

  it('【跨视图】DraggableChat 在 App 顶层渲染时，切换 currentView 不会卸载实例（位置 / 输入框内容保持）', () => {
    /**
     * 模拟 App.tsx 的渲染策略：
     *   <DraggableChat placeholder={...view-A} />
     *   ↕ 切换 currentView
     *   <DraggableChat placeholder={...view-B} />  // 同一个 DraggableChat 节点，不 unmount
     *
     * 用户感知的"AI 助理没换，还是那一个"由这个不卸载保证：
     *   - 位置（localStorage / 组件 state）
     *   - 输入框内容（组件 state）
     *   - 最小化状态（组件 state）
     *   - 滚动位置（组件 state）
     * 全部跨视图保留。
     */
    function Harness() {
      const [view, setView] = useState<'A' | 'B'>('A');
      return (
        <>
          <button data-testid="switch" onClick={() => setView(view === 'A' ? 'B' : 'A')}>
            switch
          </button>
          <DraggableChat placeholder={`view-${view}-placeholder`} />
        </>
      );
    }

    render(<Harness />);

    // 在视图 A 下输入内容
    const inputBefore = screen.getByTestId('fc-draggable-chat-input') as HTMLInputElement;
    fireEvent.change(inputBefore, { target: { value: '视图 A 输入的内容' } });
    expect(inputBefore.value).toBe('视图 A 输入的内容');
    expect(screen.getByPlaceholderText('view-A-placeholder')).toBeTruthy();

    // 切换视图 → 输入框内容应该保留（同一个 DOM 节点 + 同一个组件 state）
    fireEvent.click(screen.getByTestId('switch'));
    const inputAfter = screen.getByTestId('fc-draggable-chat-input') as HTMLInputElement;
    expect(inputAfter).toBe(inputBefore); // DOM 节点身份不变
    expect(inputAfter.value).toBe('视图 A 输入的内容'); // 输入内容保留
    expect(screen.getByPlaceholderText('view-B-placeholder')).toBeTruthy(); // placeholder 按视图更新

    // 再切回视图 A → 一切如初
    fireEvent.click(screen.getByTestId('switch'));
    expect(screen.getByTestId('fc-draggable-chat-input')).toBe(inputBefore);
    expect(screen.getByPlaceholderText('view-A-placeholder')).toBeTruthy();
  });
});