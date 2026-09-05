/** @jest-environment jsdom */
/**
 * 开发日志持久化单测（UT-DLP-001~007）：
 *
 * 背景：「💬 开发日志」Tab 之前只在内存里累积，切项目或刷新就丢。
 * 现在把 devProgress 落到 localStorage（key = freecoder.devProgress.{projectId}），
 * 重新打开项目后立刻回填，让历史日志可恢复。
 *
 * 测试覆盖：
 * - appendDevProgress 自动写入 localStorage
 * - 切到新项目时 setProject 触发 loadDevProgress 回填
 * - clearDevProgress 同时清掉 localStorage 条目
 * - 直接调 loadDevProgress 也能从 localStorage 读取
 * - localStorage 抛错（隐私模式 / 容量满）时静默失败，不影响主流程
 * - 数据格式错误（非数组 / 含非字符串）时静默保留现状
 */
import { useChatStore } from '../../src/renderer/store/chat';

const STORAGE_KEY_PREFIX = 'freecoder.devProgress.';

function readStorage(projectId: string): string[] | null {
  const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
  if (raw === null) return null;
  return JSON.parse(raw) as string[];
}

describe('chat store：开发日志 localStorage 持久化', () => {
  beforeEach(() => {
    // 每个用例前清掉 store 与 localStorage，避免上一个用例残留影响。
    useChatStore.setState({
      currentProjectId: null,
      devProgress: [],
    });
    localStorage.clear();
  });

  it('UT-DLP-001 appendDevProgress 自动写入 localStorage（按项目分桶）', () => {
    useChatStore.setState({ currentProjectId: 'proj-A' });
    useChatStore.getState().appendDevProgress('🛠 写入 index.html');
    useChatStore.getState().appendDevProgress('🛠 启动 dev server');

    const stored = readStorage('proj-A');
    expect(stored).toEqual(['🛠 写入 index.html', '🛠 启动 dev server']);
    // 不同项目分桶互不污染：proj-B 的 key 必须为空
    expect(readStorage('proj-B')).toBeNull();
  });

  it('UT-DLP-002 appendDevProgress 在 > 40 条时自动截断，store 与 storage 长度一致', () => {
    useChatStore.setState({ currentProjectId: 'proj-A' });
    for (let i = 0; i < 45; i += 1) {
      useChatStore.getState().appendDevProgress(`step-${i}`);
    }
    // 内存里只保留最近 40 条
    expect(useChatStore.getState().devProgress).toHaveLength(40);
    expect(useChatStore.getState().devProgress[0]).toBe('step-5');
    expect(useChatStore.getState().devProgress[39]).toBe('step-44');
    // localStorage 同步截断
    expect(readStorage('proj-A')).toHaveLength(40);
    expect(readStorage('proj-A')?.[0]).toBe('step-5');
  });

  it('UT-DLP-003 setProject 触发 loadDevProgress：切回项目后历史日志自动恢复', () => {
    // 模拟上次会话：项目 A 已经累积了一些日志
    useChatStore.setState({ currentProjectId: 'proj-A' });
    useChatStore.getState().appendDevProgress('历史-1');
    useChatStore.getState().appendDevProgress('历史-2');
    expect(readStorage('proj-A')).toEqual(['历史-1', '历史-2']);

    // 用户切到项目 B
    useChatStore.getState().setProject('proj-B');
    // 此时 store 已被清空 + 尝试加载 proj-B（无历史）
    expect(useChatStore.getState().devProgress).toEqual([]);
    expect(readStorage('proj-B')).toBeNull();

    // 用户切回项目 A —— 应自动回填历史
    useChatStore.getState().setProject('proj-A');
    expect(useChatStore.getState().devProgress).toEqual(['历史-1', '历史-2']);
  });

  it('UT-DLP-004 clearDevProgress 同时清掉 localStorage 条目', () => {
    useChatStore.setState({ currentProjectId: 'proj-A' });
    useChatStore.getState().appendDevProgress('将被清掉');
    expect(readStorage('proj-A')).toEqual(['将被清掉']);

    useChatStore.getState().clearDevProgress();
    expect(useChatStore.getState().devProgress).toEqual([]);
    // localStorage 条目也必须清掉，避免下次 loadDevProgress 又回填
    expect(readStorage('proj-A')).toBeNull();
  });

  it('UT-DLP-005 直接调 loadDevProgress(projectId) 也能恢复（外部入口完整）', () => {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}proj-X`,
      JSON.stringify(['从外部写进去的日志']),
    );
    useChatStore.setState({ currentProjectId: null, devProgress: [] });

    useChatStore.getState().loadDevProgress('proj-X');
    expect(useChatStore.getState().devProgress).toEqual(['从外部写进去的日志']);
  });

  it('UT-DLP-006 数据格式错误（非数组 / 含非字符串）时静默保持现状，不污染 store', () => {
    // 写入一个非数组 JSON
    localStorage.setItem(`${STORAGE_KEY_PREFIX}proj-bad-1`, JSON.stringify({ a: 1 }));
    // 写入一个数组但含非字符串项
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}proj-bad-2`,
      JSON.stringify(['ok', 42, null]),
    );

    useChatStore.setState({ currentProjectId: null, devProgress: ['existing'] });

    useChatStore.getState().loadDevProgress('proj-bad-1');
    // 保持原值（不重置为 []）
    expect(useChatStore.getState().devProgress).toEqual(['existing']);

    useChatStore.getState().loadDevProgress('proj-bad-2');
    // 防御性过滤：只保留字符串项
    expect(useChatStore.getState().devProgress).toEqual(['ok']);
  });

  it('UT-DLP-007 localStorage 抛错时（隐私模式 / 容量满）静默失败，不影响主流程', () => {
    // 模拟 setItem 抛错（隐私模式 / QuotaExceededError）
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      useChatStore.setState({ currentProjectId: 'proj-A', devProgress: [] });
      // 不应该抛出 —— appendDevProgress 必须静默吞掉 localStorage 异常
      expect(() =>
        useChatStore.getState().appendDevProgress('写入失败也没关系'),
      ).not.toThrow();
      // 内存里的 devProgress 仍然正确
      expect(useChatStore.getState().devProgress).toEqual(['写入失败也没关系']);
    } finally {
      setItemSpy.mockRestore();
    }

    // 模拟 getItem 抛错 —— loadDevProgress 也必须静默
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      useChatStore.setState({ currentProjectId: null, devProgress: ['existing'] });
      expect(() => useChatStore.getState().loadDevProgress('proj-A')).not.toThrow();
      // 保持原值
      expect(useChatStore.getState().devProgress).toEqual(['existing']);
    } finally {
      getItemSpy.mockRestore();
    }
  });
});
