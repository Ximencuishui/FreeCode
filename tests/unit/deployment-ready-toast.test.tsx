/** @jest-environment jsdom */
/**
 * P0 建议 3 单测：useDeploymentReadyToast 边沿触发。
 *
 * 锁定契约：
 *   - 边沿触发：prev=developing → cur=ready / exported 时 push 一条 success 通知
 *   - 同一状态再次设置不重复触发（如 ready → ready）
 *   - 非 developing → ready 边沿不触发（如 draft → ready）
 *   - 用户已在 deploy 视图时不打扰
 *   - 切换项目（projectId 变化）不触发，避免旧项目状态污染新项目
 *   - ready → exported 也是有意义的边沿（导出成功后值得提醒一次）
 *
 * hook 内部依赖 useChatStore / useProjectStore / useUiStore，
 * 单测通过 setState 模拟 store 变化，验证 pushNotification 调用。
 */
import { act, renderHook } from '@testing-library/react';
import { useDeploymentReadyToast } from '../../src/renderer/hooks/useDeploymentReadyToast';
import { useChatStore } from '../../src/renderer/store/chat';
import { useProjectStore } from '../../src/renderer/store/project';
import { useUiStore } from '../../src/renderer/store/ui';

interface PushCall {
  kind: 'success' | 'info' | 'warning';
  icon?: string;
  message: string;
  action?: { label: string; onClick: () => void };
  autoDismissMs?: number;
}

function installPushSpy(): { calls: PushCall[]; restore: () => void } {
  const calls: PushCall[] = [];
  const original = useUiStore.getState().pushNotification;
  useUiStore.setState({
    pushNotification: (input) => {
      calls.push(input as PushCall);
      return `spy-${calls.length}`;
    },
  });
  return {
    calls,
    restore: () => useUiStore.setState({ pushNotification: original }),
  };
}

describe('useDeploymentReadyToast（P0 建议 3）', () => {
  beforeEach(() => {
    useChatStore.setState({ projectStatus: null });
    useProjectStore.setState({ currentProjectId: 'p1', projects: [] });
    useUiStore.setState({
      currentView: 'chat',
      notifications: [],
    });
  });

  it('P0-RT-001 developing → ready 触发 push，kind=success，含「去看部署」动作', () => {
    const spy = installPushSpy();
    try {
      act(() => {
        useChatStore.setState({ projectStatus: 'developing' });
        renderHook(() => useDeploymentReadyToast());
      });
      // 初始化时是 developing，prev=developing → 不触发（首次挂载没有"上一态"）
      expect(spy.calls).toHaveLength(0);

      // 边沿：developing → ready
      act(() => {
        useChatStore.setState({ projectStatus: 'ready' });
      });
      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0]?.kind).toBe('success');
      expect(spy.calls[0]?.message).toContain('应用已就绪');
      expect(spy.calls[0]?.action?.label).toBe('去看部署');
      expect(spy.calls[0]?.autoDismissMs).toBe(8_000);
    } finally {
      spy.restore();
    }
  });

  it('P0-RT-002 developing → exported 触发 push，文案不同', () => {
    const spy = installPushSpy();
    try {
      act(() => {
        useChatStore.setState({ projectStatus: 'developing' });
        renderHook(() => useDeploymentReadyToast());
      });
      act(() => {
        useChatStore.setState({ projectStatus: 'exported' });
      });
      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0]?.message).toContain('部署包已就绪');
    } finally {
      spy.restore();
    }
  });

  it('P0-RT-003 ready → ready 不重复触发', () => {
    const spy = installPushSpy();
    try {
      act(() => {
        useChatStore.setState({ projectStatus: 'ready' });
        renderHook(() => useDeploymentReadyToast());
      });
      // 初始挂载时 prev=null → 不触发
      expect(spy.calls).toHaveLength(0);

      // 再次设置 ready → 同一状态，prev=ready → cur=ready，边沿不存在
      act(() => {
        useChatStore.setState({ projectStatus: 'ready' });
      });
      expect(spy.calls).toHaveLength(0);
    } finally {
      spy.restore();
    }
  });

  it('P0-RT-004 非 developing → ready 边沿不触发（如 draft → ready）', () => {
    const spy = installPushSpy();
    try {
      act(() => {
        useChatStore.setState({ projectStatus: 'draft' });
        renderHook(() => useDeploymentReadyToast());
      });
      act(() => {
        useChatStore.setState({ projectStatus: 'ready' });
      });
      expect(spy.calls).toHaveLength(0);
    } finally {
      spy.restore();
    }
  });

  it('P0-RT-005 用户已在 deploy 视图时不打扰', () => {
    const spy = installPushSpy();
    try {
      act(() => {
        useUiStore.setState({ currentView: 'deploy' });
        useChatStore.setState({ projectStatus: 'developing' });
        renderHook(() => useDeploymentReadyToast());
      });
      act(() => {
        useChatStore.setState({ projectStatus: 'ready' });
      });
      expect(spy.calls).toHaveLength(0);
    } finally {
      spy.restore();
    }
  });

  it('P0-RT-006 切换项目（projectId 变化）不触发，即使新项目状态是 ready', () => {
    const spy = installPushSpy();
    try {
      act(() => {
        useProjectStore.setState({ currentProjectId: 'p1' });
        useChatStore.setState({ projectStatus: 'developing' });
        renderHook(() => useDeploymentReadyToast());
      });
      // 切到另一个项目，状态直接是 ready（典型恢复场景）
      act(() => {
        useProjectStore.setState({ currentProjectId: 'p2' });
        useChatStore.setState({ projectStatus: 'ready' });
      });
      expect(spy.calls).toHaveLength(0);
    } finally {
      spy.restore();
    }
  });

  it('P0-RT-007 ready → exported 也算边沿（导出成功值得提醒一次）', () => {
    const spy = installPushSpy();
    try {
      act(() => {
        useChatStore.setState({ projectStatus: 'ready' });
        renderHook(() => useDeploymentReadyToast());
      });
      // 首次挂载 prev=null → 不触发
      expect(spy.calls).toHaveLength(0);

      act(() => {
        useChatStore.setState({ projectStatus: 'exported' });
      });
      // ready → exported 也是状态变化，触发
      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0]?.message).toContain('部署包已就绪');
    } finally {
      spy.restore();
    }
  });

  it('P0-RT-008 action.onClick 应调 setView(\'deploy\')', () => {
    const spy = installPushSpy();
    const setViewSpy = jest.fn();
    const originalSetView = useUiStore.getState().setView;
    useUiStore.setState({ setView: setViewSpy });
    try {
      act(() => {
        useChatStore.setState({ projectStatus: 'developing' });
        renderHook(() => useDeploymentReadyToast());
      });
      act(() => {
        useChatStore.setState({ projectStatus: 'ready' });
      });
      // 触发 action.onClick
      spy.calls[0]?.action?.onClick();
      expect(setViewSpy).toHaveBeenCalledWith('deploy');
    } finally {
      spy.restore();
      useUiStore.setState({ setView: originalSetView });
    }
  });
});
