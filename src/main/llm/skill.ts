/**
 * Skill 抽象层：把"轻量 LLM 任务"封装成统一入口。
 *
 * 用途：
 * - 与 DSH 解耦。DSH 是开发引擎，需求调研阶段不需要启动子进程；
 * - 新建项目后的"破冰"是典型场景：调一次 chat completion，把结果作为 assistant
 *   消息持久化并广播给前端。
 *
 * 设计要点：
 * - Skill 接口只关心「拼出 messages」，由 runSkill 统一负责「调用 LLM + 持久化 + 广播」；
 * - thinking 增量走 chat:response type='thinking'；最终回复走 type='message' + 'done'；
 * - 错误分流：API_KEY_MISSING 静默（ProjectWelcome 已显示顶部提示）；
 *   AUTH_INVALID / LLM_ERROR / TIMEOUT 走 chat:signal 推系统提示；
 * - chat:history 读写失败只 console.warn，不广播——避免红色刺眼错误提示。
 */

import type { SignalEvent, ChatResponseEvent } from '../../shared/types/chat';
import type { StorageManager } from '../storage/types';
import type { LLMClient, LLMError, LLMMessage } from './client';

/** Skill 标识；用于日志、sessionId 前缀、统计 */
export type SkillId = 'icebreaking';

/** Skill 自己的入参（每个 skill 自定义所需字段） */
export interface SkillInput {
  projectName: string;
}

/** Skill 抽象：定义 system prompt 与拼 messages 的策略 */
export interface Skill {
  /** 唯一 id；用于日志与 sessionId 前缀 */
  id: SkillId;
  /** 系统提示词（仅在该 skill 内部拼 messages 时用） */
  systemPrompt: string;
  /**
   * 拼装请求的 messages 数组（最后一个 user 消息是 skill 自己的触发器）。
   * 注意：调用方会把 systemPrompt 注入第一条 system 消息；此处返回 user/assistant 即可。
   */
  buildMessages: (input: SkillInput) => Array<Omit<LLMMessage, 'role'> & { role: 'user' | 'assistant' }>;
}

/** runSkill 依赖：storage + llm + 广播函数（与 IPC 模块解耦，便于单测） */
export interface SkillDeps {
  storage: StorageManager;
  llm: LLMClient;
  broadcastResponse: (projectId: string, event: ChatResponseEvent) => void;
  broadcastSignal: (signal: SignalEvent) => void;
}

/** runSkill 返回：仅在成功时 resolve；失败时根据错误码走不同分支 */
export interface SkillRunResult {
  messageId: string;
  content: string;
}

/** thinking 心跳间隔（毫秒）。与 chat:send IPC 的 progressTimer 风格一致 */
const PROGRESS_INTERVAL_MS = 8_000;

/**
 * 运行一次 skill：调 LLM、持久化 assistant 消息、广播 thinking/message/done 事件。
 * 错误按 LLMError.code 分流（详见顶部注释）。
 */
export async function runSkill(
  skill: Skill,
  input: { projectName: string; projectId: string },
  deps: SkillDeps,
): Promise<SkillRunResult> {
  const { projectId, projectName } = input;
  const { storage, llm, broadcastResponse, broadcastSignal } = deps;

  const timestamp = (): string => new Date().toISOString();

  // 1. 准备 thinking 状态（同步广播，让前端立刻显示"AI 正在准备首次沟通…"）
  broadcastResponse(projectId, {
    type: 'thinking',
    content: '正在为您准备首次沟通…',
    source: 'chat',
    timestamp: timestamp(),
  });

  // 2. thinking 心跳（每 8 秒报一次已用时，避免用户空等）
  const startedAt = Date.now();
  const progressTimer = setInterval(() => {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    broadcastResponse(projectId, {
      type: 'thinking',
      content: `AI 正在准备首次沟通，已用时 ${secs} 秒…`,
      source: 'chat',
      timestamp: timestamp(),
    });
  }, PROGRESS_INTERVAL_MS);

  // 3. 拼 messages 并调 LLM（注入 systemPrompt 作为第一条 system 消息）
  const messages: LLMMessage[] = [
    { role: 'system', content: skill.systemPrompt },
    ...skill.buildMessages({ projectName }),
  ];

  try {
    const result = await llm.call({ messages, maxTokens: 800 });

    // 4. 持久化 assistant 消息（仅在成功路径走 saveChatMessage；失败不污染历史）
    const saved = await storage.saveChatMessage(projectId, {
      role: 'assistant',
      content: result.content,
      reasoning: result.reasoning,
      isComplete: true,
    });

    // 5. 广播最终消息 + done 事件
    broadcastResponse(projectId, {
      type: 'message',
      content: result.content,
      reasoning: result.reasoning,
      messageId: saved.id,
      isComplete: true,
      requirements: null,
      source: 'chat',
      timestamp: timestamp(),
    });
    broadcastResponse(projectId, {
      type: 'done',
      messageId: saved.id,
      timestamp: timestamp(),
    });

    return { messageId: saved.id, content: result.content };
  } catch (error) {
    return await handleSkillError(skill.id, projectId, error, broadcastSignal);
  } finally {
    clearInterval(progressTimer);
  }
}

/**
 * 错误分流：API_KEY_MISSING 静默，其他走 chat:signal 推系统提示。
 * 永远 resolve（不 reject）——让 fire-and-forget 的调用方无需关心。
 */
async function handleSkillError(
  skillId: SkillId,
  _projectId: string,
  error: unknown,
  broadcastSignal: (signal: SignalEvent) => void,
): Promise<SkillRunResult> {
  // 缺 key：用户在 ProjectWelcome 顶部已经看到 ⚠️ 提示，无需重复广播
  if (isLLMError(error) && error.code === 'API_KEY_MISSING') {
    process.stdout.write(`[FreeCoder] ${skillId} 跳过：${error.message}\n`);
    return { messageId: '', content: '' };
  }

  // chat:history 读写失败（saveChatMessage 抛错）：只 console.warn，不广播
  if (!isLLMError(error)) {
    process.stderr.write(`[FreeCoder] ${skillId} 持久化失败：${formatError(error)}\n`);
    // 仍然尝试广播一条错误信号，让用户看到失败原因（不污染 history）
    broadcastSignal({
      type: 'error',
      message: 'AI 助理暂时无法回应，请稍后再试',
      timestamp: new Date().toISOString(),
    });
    return { messageId: '', content: '' };
  }

  // 其他 LLM 错误：推一条系统消息
  const userMessage = friendlySkillError(error.code);
  broadcastSignal({
    type: 'error',
    message: userMessage,
    timestamp: new Date().toISOString(),
  });
  process.stderr.write(`[FreeCoder] ${skillId} LLM 错误 (${error.code})：${error.message}\n`);
  return { messageId: '', content: '' };
}

/** 类型守卫：判断是否为 LLMError（避免循环依赖；引入 client.ts 类型即可） */
function isLLMError(error: unknown): error is LLMError {
  return error instanceof Error && error.name === 'LLMError' && 'code' in error;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** LLMError.code → 用户可读提示 */
function friendlySkillError(code: string): string {
  switch (code) {
    case 'AUTH_INVALID':
      return 'AI 助理暂时无法回应，请检查 API Key 配置';
    case 'TIMEOUT':
      return 'AI 助理暂时无法回应，请稍后再试';
    case 'LLM_ERROR':
    default:
      return 'AI 助理暂时无法回应，请稍后再试或检查 API Key 配置';
  }
}