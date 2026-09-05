/**
 * P0 建议 3 单测：ui store notifications 通道。
 *
 * 覆盖：
 *   - pushNotification 返回 id、写入 notifications 数组
 *   - 同一毫秒多次 push 生成不同 id（不被去重）
 *   - dismissNotification 按 id 移除
 *   - dismissAllNotifications 清空
 *   - 自动消失计时器由 NotificationHost 内部 effect 维护（store 不感知）
 *
 * NotificationHost 的渲染层由 NotificationHost.test.tsx 覆盖；
 * 这里只测纯 store action。
 */
import { useUiStore } from '../../src/renderer/store/ui';

describe('useUiStore.notifications（P0 建议 3）', () => {
  beforeEach(() => {
    useUiStore.setState({ notifications: [] });
  });

  it('P0-NOTI-001 pushNotification 追加并返回 id', () => {
    const id = useUiStore.getState().pushNotification({
      kind: 'success',
      message: '应用已就绪',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(useUiStore.getState().notifications).toHaveLength(1);
    expect(useUiStore.getState().notifications[0]?.message).toBe('应用已就绪');
    expect(useUiStore.getState().notifications[0]?.id).toBe(id);
  });

  it('P0-NOTI-002 同一毫秒多次 push 生成不同 id（不被去重）', () => {
    const id1 = useUiStore.getState().pushNotification({ kind: 'info', message: 'A' });
    const id2 = useUiStore.getState().pushNotification({ kind: 'info', message: 'B' });
    const id3 = useUiStore.getState().pushNotification({ kind: 'info', message: 'C' });
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(useUiStore.getState().notifications.map((n) => n.message)).toEqual(['A', 'B', 'C']);
  });

  it('P0-NOTI-003 pushNotification 透传 kind / icon / action / autoDismissMs', () => {
    const action = { label: '去看', onClick: jest.fn() };
    useUiStore.getState().pushNotification({
      kind: 'warning',
      icon: '⚠️',
      message: '请注意',
      action,
      autoDismissMs: 5000,
    });
    const n = useUiStore.getState().notifications[0];
    expect(n?.kind).toBe('warning');
    expect(n?.icon).toBe('⚠️');
    expect(n?.action).toBe(action);
    expect(n?.autoDismissMs).toBe(5000);
    expect(typeof n?.createdAt).toBe('number');
  });

  it('P0-NOTI-004 dismissNotification 按 id 移除一条，其他保留', () => {
    const id1 = useUiStore.getState().pushNotification({ kind: 'info', message: 'A' });
    const id2 = useUiStore.getState().pushNotification({ kind: 'info', message: 'B' });
    const id3 = useUiStore.getState().pushNotification({ kind: 'info', message: 'C' });
    useUiStore.getState().dismissNotification(id2);
    const messages = useUiStore.getState().notifications.map((n) => n.message);
    expect(messages).toEqual(['A', 'C']);
    expect(useUiStore.getState().notifications.map((n) => n.id)).toEqual([id1, id3]);
  });

  it('P0-NOTI-005 dismissNotification 传入不存在的 id 是 no-op', () => {
    useUiStore.getState().pushNotification({ kind: 'info', message: 'A' });
    useUiStore.getState().dismissNotification('not-exists');
    expect(useUiStore.getState().notifications).toHaveLength(1);
  });

  it('P0-NOTI-006 dismissAllNotifications 清空（切项目场景）', () => {
    useUiStore.getState().pushNotification({ kind: 'info', message: 'A' });
    useUiStore.getState().pushNotification({ kind: 'info', message: 'B' });
    useUiStore.getState().dismissAllNotifications();
    expect(useUiStore.getState().notifications).toEqual([]);
  });

  it('P0-NOTI-007 pushNotification 不修改原始输入对象（防御性拷贝）', () => {
    const input = { kind: 'info' as const, message: 'A' };
    useUiStore.getState().pushNotification(input);
    // input 自身不应被加上 id / createdAt
    expect((input as unknown as { id?: string }).id).toBeUndefined();
    expect((input as unknown as { createdAt?: number }).createdAt).toBeUndefined();
  });
});
