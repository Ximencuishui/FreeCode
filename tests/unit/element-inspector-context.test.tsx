/** @jest-environment jsdom */
/**
 * v0.1.02 P1-4：ElementInspector 内的 MiniChat 必须把选中元素作为 elementContext 传给
 * chat store.sendMessage（UT-EIC-001~005）。
 *
 * 验收报告 P1-4：原先 ElementInspector 上的 isProcessing/onSendModify 是死参数，
 * 用户在检查器内输入修改指令后，DSH 收到的对话里不包含选中元素描述 —— 等于"口语修改上下文"
 * 没被传递。修复后：ElementInspector 把 element 作为 elementContext 透传给 MiniChat，
 * MiniChat 发送时强制把它作为本次发送的 selectedElement，覆盖 store 中的全局值。
 *
 * 本单测覆盖三层契约：
 *  1) MiniChat 在 elementContext 非空时，把 elementContext 透传为 sendMessage 的 options.selectedElement
 *  2) MiniChat 在 elementContext 为空时不传 options（避免误覆盖 store 中合法的 selectedElement）
 *  3) chat store.sendMessage 内部：options.selectedElement 优先级 > store.selectedElement
 *  4) chat store.sendMessage 内部：IPC chat.send 调用包含 selectedElement 字段
 *  5) ElementInspector 把 element prop 作为 elementContext 透传给 MiniChat
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ElementInfo, ElementSelectResult } from '@shared/types/preview';
import MiniChat from '../../src/renderer/components/Chat/MiniChat';
import ElementInspector from '../../src/renderer/components/Preview/ElementInspector';
import { useChatStore } from '../../src/renderer/store/chat';
import { useUiStore } from '../../src/renderer/store/ui';

interface ElectronChatMock {
  send: jest.Mock;
  onResponse: jest.Mock;
  onSignal: jest.Mock;
  stop: jest.Mock;
  getHistory: jest.Mock;
}

declare global {
  var window: Window & {
    electron: { chat: ElectronChatMock };
  };
}

function installElectronChatMock(): ElectronChatMock {
  const electronChat: ElectronChatMock = {
    send: jest.fn(async () => ({ success: true })),
    onResponse: jest.fn(() => () => undefined),
    onSignal: jest.fn(() => () => undefined),
    stop: jest.fn(async () => ({ success: true })),
    getHistory: jest.fn(async () => ({ messages: [] })),
  };
  (window as unknown as { electron: { chat: ElectronChatMock } }).electron = {
    chat: electronChat,
  };
  return electronChat;
}

/** 构造一个 ElementInfo 测试桩 */
function makeElement(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tag: 'h1',
    content: '欢迎使用 FreeCoder',
    selector: 'h1.title',
    styles: { color: '#1A2B3C', fontSize: '32px', fontWeight: 'bold' },
    position: { x: 0, y: 0, width: 400, height: 48 },
    ...overrides,
  };
}

/** 构造一个 elementInfo 测试桩（ElementSelectResult['elementInfo']） */
function makeElementInfo(
  overrides: Partial<NonNullable<ElementSelectResult['elementInfo']>> = {},
): NonNullable<ElementSelectResult['elementInfo']> {
  return {
    name: '页面标题',
    description: '这是 H1 标题，展示应用名',
    suggestedActions: [
      { label: '改颜色', action: 'change-color' },
      { label: '改字号', action: 'change-size' },
    ],
    ...overrides,
  };
}

describe('ElementInspector / MiniChat 元素上下文透传（v0.1.02 P1-4）', () => {
  beforeEach(() => {
    // chat store：干净 + 假装已配置 API Key（否则 sendMessage 会改去 openSettings）
    useChatStore.setState({
      messages: [],
      isProcessing: false,
      currentProjectId: 'proj-test',
      selectedElement: null,
    });
    useUiStore.setState({
      apiKeyConfigured: true,
      settingsOpen: false,
      inviteMode: false,
    });
    installElectronChatMock();
    // jsdom 不实现 Element.prototype.scrollTo —— 给所有 div 注入空函数桩，
    // 避免 MiniChat 的 useEffect(() => scrollRef.current?.scrollTo(...)) 在 mount 时炸掉。
    // 这是测试环境问题，与 P1-4 业务逻辑无关。
    const proto = (globalThis as { HTMLElement?: { prototype: { scrollTo?: unknown } } })
      .HTMLElement?.prototype;
    if (proto && typeof proto.scrollTo !== 'function') {
      (proto as { scrollTo: () => void }).scrollTo = function () {
        /* noop */
      };
    }
  });

  it('UT-EIC-001 MiniChat 传入 elementContext 时：sendMessage 带 {selectedElement: elementContext, metadata.contextElement}', () => {
    const element = makeElement();
    const sendSpy = jest
      .spyOn(useChatStore.getState(), 'sendMessage')
      .mockResolvedValue(undefined);
    try {
      render(<MiniChat elementContext={element} />);
      const input = screen.getByPlaceholderText(/输入消息/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '把标题颜色调亮一点' } });
      fireEvent.click(screen.getByText('发送'));

      // 必须把 elementContext 作为 options.selectedElement 透传
      // v3.2.2 P0-4：同时携带 metadata.contextElement，让消息气泡显示「关于 [元素]」角标，
      // 避免双输入框（DraggableChat / ElementInspector）的上下文串台。
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        '把标题颜色调亮一点',
        expect.objectContaining({
          selectedElement: element,
          metadata: {
            contextElement: {
              description: `${element.tag} · ${element.selector}`,
              tag: element.tag,
              selector: element.selector,
            },
          },
        }),
      );
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('UT-EIC-002 MiniChat 不传 elementContext 时：sendMessage 不带 options（沿用 store 全局值）', () => {
    const sendSpy = jest
      .spyOn(useChatStore.getState(), 'sendMessage')
      .mockResolvedValue(undefined);
    try {
      render(<MiniChat />);
      const input = screen.getByPlaceholderText(/输入消息/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Hello DSH' } });
      fireEvent.click(screen.getByText('发送'));

      expect(sendSpy).toHaveBeenCalledTimes(1);
      // 第二参必须严格为 undefined（不传 options，避免误覆盖 store 中合法的 selectedElement）
      expect(sendSpy).toHaveBeenCalledWith('Hello DSH', undefined);
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('UT-EIC-003 sendMessage：options.selectedElement 优先级 > store.selectedElement', async () => {
    // store 里的 selectedElement 是另一个值（"老选中"）
    const stale = makeElement({ tag: 'button', content: '旧选中' });
    const fresh = makeElement({ tag: 'h1', content: '新选中' });
    useChatStore.setState({ selectedElement: stale });

    await useChatStore.getState().sendMessage('修改标题', { selectedElement: fresh });

    const mock = (window as unknown as { electron: { chat: ElectronChatMock } }).electron.chat;
    expect(mock.send).toHaveBeenCalledTimes(1);
    const callArg = mock.send.mock.calls[0][0] as {
      projectId: string;
      message: string;
      selectedElement?: ElementInfo;
    };
    // 必须用 fresh（options 覆盖 store），而不是 stale
    expect(callArg.selectedElement).toEqual(fresh);
    expect(callArg.selectedElement).not.toEqual(stale);
  });

  it('UT-EIC-004 sendMessage：不传 options 时使用 store.selectedElement，IPC chat.send 携带 selectedElement 字段', async () => {
    const el = makeElement({ tag: 'p', content: '段落' });
    useChatStore.setState({ selectedElement: el });

    await useChatStore.getState().sendMessage('改字号');

    const mock = (window as unknown as { electron: { chat: ElectronChatMock } }).electron.chat;
    expect(mock.send).toHaveBeenCalledTimes(1);
    const callArg = mock.send.mock.calls[0][0] as {
      projectId: string;
      message: string;
      selectedElement?: ElementInfo;
    };
    expect(callArg.message).toBe('改字号');
    expect(callArg.projectId).toBe('proj-test');
    expect(callArg.selectedElement).toEqual(el);
  });

  it('UT-EIC-005 ElementInspector 把 element 作为 elementContext 透传给 MiniChat（含 P0-4 metadata）', () => {
    const element = makeElement({ tag: 'button', content: '提交' });
    const info = makeElementInfo({
      name: '提交按钮',
      description: '表单底部的提交按钮',
      suggestedActions: [{ label: '改文字', action: 'edit-text' }],
    });
    // spy sendMessage：观察 MiniChat 内部调用是否把 element 透传过来
    const sendSpy = jest
      .spyOn(useChatStore.getState(), 'sendMessage')
      .mockResolvedValue(undefined);
    try {
      // onSendModify 在 ElementInspector 当前实现里已废弃（保留类型兼容），
      // 这里传一个空 spy，避免破坏未来对该 prop 的兼容性测试。
      render(<ElementInspector element={element} info={info} isProcessing={false} onSendModify={jest.fn()} />);
      // 找到检查器内的 MiniChat 输入框（placeholder 是 "例如：颜色太深了，调亮一点"）
      const input = screen.getByPlaceholderText(/颜色太深了/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '把按钮文字改成「保存」' } });
      fireEvent.click(screen.getByText('发送'));

      // ElementInspector 必须把 element 作为 elementContext 透传
      // v3.2.2 P0-4：同时携带 metadata.contextElement，让 Message.tsx 在气泡上显示
      // 「关于 button · h1.title」角标。
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        '把按钮文字改成「保存」',
        expect.objectContaining({
          selectedElement: element,
          metadata: {
            contextElement: {
              description: `${element.tag} · ${element.selector}`,
              tag: element.tag,
              selector: element.selector,
            },
          },
        }),
      );
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('UT-EIC-006 [额外回归] store 里有 selectedElement 时，ElementInspector 仍优先用 element prop（避免 store 污染检查器上下文）', () => {
    // store 里有一个"过期"的 selectedElement（来自上个元素）
    const stale = makeElement({ tag: 'div', content: '上一个元素' });
    const fresh = makeElement({ tag: 'a', content: '新链接' });
    useChatStore.setState({ selectedElement: stale });

    const info = makeElementInfo({ name: '链接', description: '导航链接' });
    const sendSpy = jest
      .spyOn(useChatStore.getState(), 'sendMessage')
      .mockResolvedValue(undefined);
    try {
      render(<ElementInspector element={fresh} info={info} isProcessing={false} />);
      const input = screen.getByPlaceholderText(/颜色太深了/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '去掉下划线' } });
      fireEvent.click(screen.getByText('发送'));

      // 即使 store 里有 stale，options.selectedElement 必须等于 fresh
      const call = sendSpy.mock.calls[0];
      expect(call[0]).toBe('去掉下划线');
      expect((call[1] as { selectedElement: ElementInfo }).selectedElement).toEqual(fresh);
    } finally {
      sendSpy.mockRestore();
    }
  });
});
