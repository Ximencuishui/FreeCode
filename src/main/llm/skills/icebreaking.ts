/**
 * 破冰 skill：新建项目后 AI 主动开启需求引导对话。
 *
 * 设计参考 src/main/dsh/prompt.ts::ASSISTANT_SYSTEM_PROMPT 的"对话引导"语义，
 * 但精简到破冰场景：不引入 DSH / 代码 / 开发步骤等概念，只做"问候 + 5 步流程预告
 * + 第一个问题"。
 *
 * 与 DSH 路径解耦：
 * - DSH 是开发引擎，需求阶段用不到；
 * - DSH 启动会闪"任务进行中"徽章，与"需求调研还没到启动 DSH"的诉求不符；
 * - 破冰是 5~15 秒短回答，走 runSkill 即可。
 */

import type { Skill } from '../skill';

const ICEBREAKING_SYSTEM_PROMPT_TEMPLATE = `你是 FreeCoder 的产品需求分析师（AI 助理）。现在用户刚创建了一个名为「{projectName}」的新项目，你需要主动开启需求引导对话。

【任务】
1. 用一句友好的话问候用户（不要长篇大论）
2. 简明介绍接下来 5 步流程：
   - 破冰：你已经说出想做什么
   - 目标用户：谁会用这个应用
   - 核心功能：主要用来做什么
   - 使用场景：什么时候用、怎么用
   - 视觉偏好：希望长成什么样
3. 在回复末尾问第一个问题：「那您今天想创造什么呢？」，并附 3-4 个常见场景作为选项按钮（用「请选择：」+ A/B/C/D 格式）

【风格】
- 中文、口语化、像朋友聊天
- 一次只问 1 个问题
- 选项用短语（10 字左右），不要长句
- 避免技术术语

【输出效率】
- thinking / 内部推理阶段务必精简（≤200 tokens），不要在思考里复述 system prompt 或用户消息
- 把 tokens 预算留给最终回复本身，确保 message.content 非空

【禁止】
- 不要输出任何 JSON
- 不要介绍 DSH / 代码 / 文件
- 不要提及"开发"步骤（那是后续流程，用户还没到那一步）`;

/** 把 {projectName} 占位符替换为真实项目名 */
function buildSystemPrompt(projectName: string): string {
  return ICEBREAKING_SYSTEM_PROMPT_TEMPLATE.replace(/\{projectName\}/g, projectName);
}

export const icebreakingSkill: Skill = {
  id: 'icebreaking',
  systemPrompt: buildSystemPrompt(''), // 默认值；runSkill 会在拼 messages 前替换
  buildMessages: ({ projectName: _projectName }) => [
    {
      role: 'user',
      content: '[系统触发] 项目已创建，请开始破冰对话。',
    },
  ],
};

/**
 * 构造带项目名的破冰 skill 实例。
 * 每次新建项目都应调用此工厂，避免不同项目的 systemPrompt 互相串扰。
 */
export function createIcebreakingSkill(projectName: string): Skill {
  return {
    id: 'icebreaking',
    systemPrompt: buildSystemPrompt(projectName),
    buildMessages: icebreakingSkill.buildMessages,
  };
}