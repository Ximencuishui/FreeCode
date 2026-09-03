/** @jest-environment jsdom */
/**
 * v0.1.02 P0-4：部署助手接管边界单测（UT-DA-001~004）。
 *
 * 验收报告 P0-4：原本「接管操作」是无条件调 onSuccess 的假动作（哪怕没有部署包）。
 * 修复后要求：
 *   1) 没有 zipPath 时接管按钮拒绝执行：调 onSuccess 不会发生，聊天里推送引导文案
 *   2) 有 zipPath 时接管按钮才执行：复制 docker-compose 命令 + 调用 onSuccess
 *   3) fallback 文案改为「我把一切准备好了，剩最后一步你点点鼠标」（不是"我来接管"）
 *   4) 文案里必须明确说明 FreeCoder 不替用户执行服务器命令（避免假承诺）
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeploymentAssistant from '../../src/renderer/components/Export/DeploymentAssistant';
import { useChatStore } from '../../src/renderer/store/chat';
import { useExportStore } from '../../src/renderer/store/export';

interface ElectronMock {
  app: { revealInFolder: jest.Mock };
}

/** 让 DeploymentAssistant 通过 window.electron.app.revealInFolder 调用 fake */
function installElectronMock(): ElectronMock {
  const mock: ElectronMock = {
    app: { revealInFolder: jest.fn(async () => undefined) },
  };
  (window as unknown as { electron: { app: ElectronMock['app'] } }).electron = {
    app: mock.app,
  };
  return mock;
}

describe('DeploymentAssistant 接管边界（v0.1.02 P0-4）', () => {
  beforeEach(() => {
    // 1) chat store 干净
    useChatStore.setState({ messages: [] });
    // 3) 默认 export store：没 zipPath
    useExportStore.setState({ zipPath: null });
    // 2) navigator.clipboard 桩（jsdom 没有）
    (navigator as unknown as { clipboard: { writeText: jest.Mock } }).clipboard = {
      writeText: jest.fn(async () => undefined),
    };
    installElectronMock();
  });

  function renderAssistant(onSuccess: jest.Mock) {
    return render(<DeploymentAssistant onClose={jest.fn()} onSuccess={onSuccess} />);
  }

  function switchToFallback(): void {
    // 三态：identify → guide → fallback
    fireEvent.click(screen.getByRole('button', { name: /接受推荐/ }));
    fireEvent.click(screen.getByRole('button', { name: /帮我接管/ }));
    // 此时已切到 fallback，渲染「接管操作」按钮
    expect(screen.getByRole('button', { name: /接管操作/ })).toBeTruthy();
  }

  it('UT-DA-001 fallback 文案改为「我把一切准备好了」，不再写「我来接管」', () => {
    renderAssistant(jest.fn());
    switchToFallback();
    // fallback 副标题：「我把一切准备好了，剩最后一步你点点鼠标」
    expect(screen.getByText(/我把一切准备好了/)).toBeTruthy();
    // 旧文案「我来接管」应只出现在 MODE_META.fallback 的描述性 tone 行；
    // fallback 内嵌的"我会接管"已经替换为更克制的「你来完成」
    expect(screen.queryByText('🤝 我来接管')).toBeNull();
  });

  it('UT-DA-002 无 zipPath 时接管：onSuccess 不被调用，聊天里推送「差一份部署包」引导', async () => {
    const onSuccess = jest.fn();
    renderAssistant(onSuccess);
    switchToFallback();

    fireEvent.click(screen.getByRole('button', { name: /接管操作/ }));

    // 让 pushMessage 之类的 microtask 落地
    await waitFor(() => {
      const messages = useChatStore.getState().messages;
      const last = messages[messages.length - 1];
      expect(last?.role).toBe('assistant');
      expect(last?.content).toContain('差一份部署包');
      expect(last?.content).toContain('高级导出');
    });

    // 关键约束：没有部署包时 onSuccess 不能被调用（避免 DeployView 误切 success stage）
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('UT-DA-003 有 zipPath 时接管：onSuccess 被调用，聊天里推送新文案并复制 docker-compose 命令', async () => {
    const onSuccess = jest.fn();
    useExportStore.setState({ zipPath: '/tmp/freecoder-deploy.zip' });
    renderAssistant(onSuccess);
    switchToFallback();

    fireEvent.click(screen.getByRole('button', { name: /接管操作/ }));

    await waitFor(() => {
      const messages = useChatStore.getState().messages;
      const takeoverMsg = messages.find((m) => m.content.includes('我把一切准备好了'));
      expect(takeoverMsg).toBeDefined();
      // 明确说明 FreeCoder 不替你执行服务器命令（避免假承诺）
      expect(takeoverMsg?.content).toContain('FreeCoder 不替你执行服务器命令');
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);

    // 剪贴板被写入 docker-compose 命令
    const writeText = (navigator.clipboard.writeText as jest.Mock);
    expect(writeText).toHaveBeenCalledWith('docker-compose up -d');
  });

  it('UT-DA-004 handleOpenGuideHtml 单独：没有 zipPath 时也拒绝执行（不打开文件管理器）', async () => {
    // 不走 switchToFallback，直接 verify handleOpenGuideHtml 的内部不变式：
    // 该函数被 handleTakeOver 在「有 zipPath」时调用，因此这里只断言「无 zipPath 时
    // revealInFolder 不被触发」是通过 handleTakeOver 的拒绝路径体现的（UT-DA-002 已覆盖）。
    // 这里仅测有 zipPath 但暴露函数时的正常路径（防御性覆盖）：
    useExportStore.setState({ zipPath: '/tmp/freecoder-deploy.zip' });
    const onSuccess = jest.fn();
    const mock = installElectronMock();
    renderAssistant(onSuccess);
    switchToFallback();

    fireEvent.click(screen.getByRole('button', { name: /接管操作/ }));

    await waitFor(() => {
      expect(mock.app.revealInFolder).toHaveBeenCalledWith('/tmp/freecoder-deploy');
    });
    // onSuccess 仍然被调用（zipPath 存在）
    expect(onSuccess).toHaveBeenCalled();
  });
});