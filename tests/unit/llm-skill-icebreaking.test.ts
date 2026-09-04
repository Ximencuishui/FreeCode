/** @jest-environment node */
/**
 * 破冰 skill 单元测试：buildMessages 结构、runSkill 广播 / 持久化、错误分流。
 */

import { runSkill } from '../../src/main/llm/skill';
import { createIcebreakingSkill, icebreakingSkill } from '../../src/main/llm/skills/icebreaking';
import { LLMError } from '../../src/main/llm/client';
import type { SkillDeps } from '../../src/main/llm/skill';
import type { StorageManager, ChatMessage } from '../../src/main/storage/types';

/** 最小可用的 StorageManager 测试桩（只覆盖 skill 用到的接口） */
function makeStorage(saveImpl?: (projectId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => Promise<ChatMessage>): {
  storage: StorageManager;
  saveChatMessage: jest.Mock;
} {
  const saveChatMessage = jest.fn(
    async (projectId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> => {
      if (saveImpl) return saveImpl(projectId, message);
      return {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        ...message,
      };
    },
  );
  const storage: StorageManager = {
    init: jest.fn(async () => undefined),
    createProject: jest.fn(),
    getProject: jest.fn(),
    listProjects: jest.fn(),
    deleteProject: jest.fn(),
    updateProjectMeta: jest.fn(),
    saveRequirements: jest.fn(),
    getRequirements: jest.fn(),
    confirmRequirements: jest.fn(),
    saveChatMessage,
    getChatHistory: jest.fn(async () => []),
    clearChatHistory: jest.fn(),
    getSettings: jest.fn(),
    saveSettings: jest.fn(),
    saveApiKey: jest.fn(),
    loadApiKey: jest.fn(),
    getProjectDir: jest.fn(),
    getProjectCodePath: jest.fn(),
    getDefaultProjectsDir: jest.fn(),
    ensureProjectDirectories: jest.fn(),
  };
  return { storage, saveChatMessage };
}

/** 构造带 mock spy 的 LLMClient-like 对象。spy 同时记录调用参数、返回值与抛错 */
function makeLLM(
  result: { content: string; reasoning?: string } = { content: 'AI 破冰回复' },
  error?: unknown,
): { callSpy: jest.Mock; llmLike: { call: jest.Mock } } {
  const callSpy = jest.fn(async () => {
    if (error) throw error;
    return result;
  });
  return { callSpy, llmLike: { call: callSpy } };
}

/** 构造一份完整的 deps（含 jest.Mock 形式的 broadcast fn）。runSkill 接受 SkillDeps 类型。 */
function makeDeps(options?: {
  result?: { content: string; reasoning?: string };
  error?: unknown;
  saveImpl?: (projectId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => Promise<ChatMessage>;
}): {
  deps: SkillDeps;
  callSpy: jest.Mock;
  broadcastResponse: jest.Mock;
  broadcastSignal: jest.Mock;
  saveChatMessage: jest.Mock;
} {
  const broadcastResponse = jest.fn();
  const broadcastSignal = jest.fn();
  const { storage, saveChatMessage } = makeStorage(options?.saveImpl);
  const { callSpy, llmLike } = makeLLM(options?.result, options?.error);
  const deps: SkillDeps = {
    storage,
    llm: llmLike as unknown as SkillDeps['llm'],
    broadcastResponse: broadcastResponse as unknown as SkillDeps['broadcastResponse'],
    broadcastSignal: broadcastSignal as unknown as SkillDeps['broadcastSignal'],
  };
  return { deps, callSpy, broadcastResponse, broadcastSignal, saveChatMessage };
}

describe('icebreaking skill / buildMessages', () => {
  it('默认 icebreakingSkill 的 systemPrompt 含 5 步流程预告与「请选择」要求', () => {
    const skill = createIcebreakingSkill('记账本');
    expect(skill.id).toBe('icebreaking');
    expect(skill.systemPrompt).toContain('破冰');
    expect(skill.systemPrompt).toContain('目标用户');
    expect(skill.systemPrompt).toContain('核心功能');
    expect(skill.systemPrompt).toContain('使用场景');
    expect(skill.systemPrompt).toContain('视觉偏好');
    expect(skill.systemPrompt).toContain('请选择');
  });

  it('createIcebreakingSkill(projectName) 把 projectName 注入 systemPrompt', () => {
    const skill = createIcebreakingSkill('我的记账 App');
    expect(skill.systemPrompt).toContain('我的记账 App');
    expect(skill.systemPrompt).not.toContain('{projectName}');
  });

  it('buildMessages 返回一条 user 触发消息', () => {
    const skill = createIcebreakingSkill('随便');
    const messages = skill.buildMessages({ projectName: '随便' });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('项目已创建');
  });

  it('导出的 icebreakingSkill 默认实例的 systemPrompt 不含占位符', () => {
    expect(icebreakingSkill.id).toBe('icebreaking');
    expect(icebreakingSkill.systemPrompt).not.toContain('{projectName}');
  });
});

describe('runSkill / 成功路径', () => {
  it('调 llm.call 后持久化 assistant 消息到 storage（含 reasoning）', async () => {
    const { deps, saveChatMessage } = makeDeps({
      result: { content: '你好！让我开始引导你', reasoning: 'thinking...' },
    });
    const skill = createIcebreakingSkill('Test');
    const result = await runSkill(skill, { projectName: 'Test', projectId: 'proj-1' }, deps);
    expect(result.messageId).toBeTruthy();
    expect(result.content).toBe('你好！让我开始引导你');
    expect(saveChatMessage).toHaveBeenCalledTimes(1);
    const [projectId, message] = saveChatMessage.mock.calls[0] as [string, object];
    expect(projectId).toBe('proj-1');
    expect(message).toMatchObject({
      role: 'assistant',
      content: '你好！让我开始引导你',
      reasoning: 'thinking...',
      isComplete: true,
    });
  });

  it('按顺序广播 thinking / message / done 事件', async () => {
    const { deps, broadcastResponse } = makeDeps();
    const skill = createIcebreakingSkill('Test');
    await runSkill(skill, { projectName: 'Test', projectId: 'proj-2' }, deps);
    const events = broadcastResponse.mock.calls.map((c) => c[1] as { type: string });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('thinking'); // 初始 thinking
    expect(types).toContain('message'); // 最终回复
    expect(types[types.length - 1]).toBe('done'); // done 是最后一帧
  });

  it('注入 messages 时包含 system（prompt 含 projectName）+ user 触发消息', async () => {
    const { deps, callSpy } = makeDeps();
    const skill = createIcebreakingSkill('MyApp');
    await runSkill(skill, { projectName: 'MyApp', projectId: 'proj-3' }, deps);
    const [request] = callSpy.mock.calls[0] as [
      { messages: Array<{ role: string; content: string }> },
    ];
    expect(request.messages[0].role).toBe('system');
    expect(request.messages[0].content).toContain('MyApp');
    expect(request.messages[1].role).toBe('user');
    expect(request.messages[1].content).toContain('项目已创建');
    // 破冰不预置 assistant 消息
    expect(request.messages.find((m) => m.role === 'assistant')).toBeUndefined();
  });
});

describe('runSkill / 错误分流', () => {
  it('API_KEY_MISSING：静默处理，不广播 signal 也不持久化', async () => {
    const { deps, saveChatMessage, broadcastSignal, broadcastResponse } = makeDeps({
      error: new LLMError('API_KEY_MISSING', '缺 key'),
    });
    const skill = createIcebreakingSkill('Test');
    const result = await runSkill(skill, { projectName: 'Test', projectId: 'proj-err-1' }, deps);
    expect(result.messageId).toBe('');
    expect(saveChatMessage).not.toHaveBeenCalled();
    expect(broadcastSignal).not.toHaveBeenCalled();
    // 但仍广播了初始 thinking（先于失败发生）
    const types = broadcastResponse.mock.calls.map((c) => (c[1] as { type: string }).type);
    expect(types).toContain('thinking');
    // message/done 都不会广播
    expect(types).not.toContain('message');
    expect(types).not.toContain('done');
  });

  it('AUTH_INVALID：广播 signal 错误提示，不广播 message', async () => {
    const { deps, saveChatMessage, broadcastSignal, broadcastResponse } = makeDeps({
      error: new LLMError('AUTH_INVALID', 'API Key 无效'),
    });
    const skill = createIcebreakingSkill('Test');
    await runSkill(skill, { projectName: 'Test', projectId: 'proj-err-2' }, deps);
    expect(broadcastSignal).toHaveBeenCalledTimes(1);
    const signal = broadcastSignal.mock.calls[0][0] as { type: string; message: string };
    expect(signal.type).toBe('error');
    expect(signal.message).toContain('API Key');
    expect(saveChatMessage).not.toHaveBeenCalled();
    const types = broadcastResponse.mock.calls.map((c) => (c[1] as { type: string }).type);
    expect(types).not.toContain('message');
  });

  it('TIMEOUT：广播 signal 错误提示', async () => {
    const { deps, broadcastSignal } = makeDeps({
      error: new LLMError('TIMEOUT', 'timeout'),
    });
    const skill = createIcebreakingSkill('Test');
    await runSkill(skill, { projectName: 'Test', projectId: 'proj-err-3' }, deps);
    expect(broadcastSignal).toHaveBeenCalledTimes(1);
    expect((broadcastSignal.mock.calls[0][0] as { type: string }).type).toBe('error');
  });

  it('LLM_ERROR：广播 signal 错误提示', async () => {
    const { deps, broadcastSignal } = makeDeps({
      error: new LLMError('LLM_ERROR', 'server down'),
    });
    const skill = createIcebreakingSkill('Test');
    await runSkill(skill, { projectName: 'Test', projectId: 'proj-err-4' }, deps);
    expect(broadcastSignal).toHaveBeenCalledTimes(1);
    expect((broadcastSignal.mock.calls[0][0] as { type: string }).type).toBe('error');
  });

  it('saveChatMessage 抛错（非 LLM 错误）也广播 signal，但不污染历史', async () => {
    const { deps, broadcastSignal, broadcastResponse } = makeDeps({
      saveImpl: async () => {
        throw new Error('disk full');
      },
    });
    const skill = createIcebreakingSkill('Test');
    await runSkill(skill, { projectName: 'Test', projectId: 'proj-err-5' }, deps);
    expect(broadcastSignal).toHaveBeenCalledTimes(1);
    const types = broadcastResponse.mock.calls.map((c) => (c[1] as { type: string }).type);
    expect(types).not.toContain('message');
  });

  it('runSkill 永远 resolve（不 reject），让 fire-and-forget 调用方无需关心', async () => {
    const { deps } = makeDeps({ error: new LLMError('AUTH_INVALID', 'fail') });
    const skill = createIcebreakingSkill('Test');
    await expect(
      runSkill(skill, { projectName: 'Test', projectId: 'proj-no-reject' }, deps),
    ).resolves.toBeDefined();
  });
});

describe('runSkill / thinking 心跳', () => {
  it('broadcastResponse 至少收到一次 thinking 事件（首帧提示）', async () => {
    const { deps, broadcastResponse } = makeDeps();
    const skill = createIcebreakingSkill('Test');
    await runSkill(skill, { projectName: 'Test', projectId: 'proj-heartbeat' }, deps);
    const thinkingEvents = broadcastResponse.mock.calls
      .map((c) => c[1] as { type: string; content: string })
      .filter((e) => e.type === 'thinking');
    expect(thinkingEvents.length).toBeGreaterThanOrEqual(1);
    expect(thinkingEvents[0].content).toContain('首次沟通');
  });
});