import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * DSH headless runner 补丁（FreeCoder 自动应用，幂等，按标记逐块应用）。
 *
 * headless 模式默认只把「text 块」最终回复打到 stdout，推理过程与工具调用都被丢弃。
 * 这里在每次启动时检查 DSH_HOME 下的 headless runner（index.js），按缺失的标记补丁：
 *   1. summarize() 额外收集 reasoning 块
 *   2. run() 实时订阅 session/event：reasoning-delta（流式思考）+ tool-call（开发进度报告）
 *   3. run() 结束时把完整推理以信封写 stdout（供持久化）
 *
 * 若某块文件结构不匹配（DSH 版本升级），跳过该块并记日志，不影响其他功能
 * （FreeCoder 解析层对无信封/无流式输出自动回退）。
 */

interface PatchEntry {
  /** 补丁应用后文件中应存在的标记；已存在则跳过该块 */
  marker: string;
  old: string;
  new: string;
}

const PATCHES: PatchEntry[] = [
  {
    // 1a. summarize：初始化 reasoning 变量
    marker: '\tlet reasoning = "";',
    old: '\tlet started = false;\n\tlet text = "";\n\tlet reason;',
    new: '\tlet started = false;\n\tlet text = "";\n\tlet reasoning = "";\n\tlet reason;',
  },
  {
    // 1b. summarize：收集 reasoning 块
    marker: 'FreeCoder patch: collect reasoning blocks',
    old: '\t\tif (event.type === "assistant/message") {\n\t\t\tconst joined = event.data.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");\n\t\t\tif (joined !== "") text = joined;\n\t\t}',
    new: '\t\tif (event.type === "assistant/message") {\n\t\t\tconst joined = event.data.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");\n\t\t\tif (joined !== "") text = joined;\n\t\t\t// FreeCoder patch: collect reasoning blocks for display\n\t\t\tconst reas = event.data.message.content.filter((block) => block.type === "reasoning").map((block) => block.text ?? "").join("");\n\t\t\tif (reas !== "") reasoning = reas;\n\t\t}',
  },
  {
    // 1c. summarize：返回 reasoning
    marker: '\t\treasoning,',
    old: '\treturn {\n\t\ttext,\n\t\treason\n\t};',
    new: '\treturn {\n\t\ttext,\n\t\treasoning,\n\t\treason\n\t};',
  },
  {
    // 2. run：实时订阅 reasoning-delta（JSON 编码避免换行错位）
    marker: '<<<FC_REASONING_STREAM>>>',
    old: '\tawait agent.whenIdle();\n\tconst firstSeq = agent.session.seq;\n\tagent.followup(createUserMessage({',
    new: '\tawait agent.whenIdle();\n\tconst firstSeq = agent.session.seq;\n\t// FreeCoder patch: stream reasoning deltas to stdout for live display\n\tconst session = agent.session;\n\tctx.on("session/event", (s, event) => {\n\t\tif (s !== session) return;\n\t\tif (event.type === "assistant/chunk" && event.data?.chunk?.type === "reasoning-delta") {\n\t\t\tconst frag = event.data.chunk.text ?? "";\n\t\t\tif (frag === "") return;\n\t\t\tio.stdout.write("<<<FC_REASONING_STREAM>>>" + JSON.stringify(frag) + "\\n");\n\t\t}\n\t});\n\tagent.followup(createUserMessage({',
  },
  {
    // 2b. run：同一订阅里输出工具调用（开发进度报告：正在写什么文件/跑什么命令/测什么）
    marker: '<<<FC_TOOL_CALL>>>',
    old: '\tctx.on("session/event", (s, event) => {\n\t\tif (s !== session) return;\n\t\tif (event.type === "assistant/chunk" && event.data?.chunk?.type === "reasoning-delta") {\n\t\t\tconst frag = event.data.chunk.text ?? "";\n\t\t\tif (frag === "") return;\n\t\t\tio.stdout.write("<<<FC_REASONING_STREAM>>>" + JSON.stringify(frag) + "\\n");\n\t\t}\n\t});\n\tagent.followup(createUserMessage({',
    new: '\tctx.on("session/event", (s, event) => {\n\t\tif (s !== session) return;\n\t\tif (event.type === "assistant/chunk" && event.data?.chunk?.type === "reasoning-delta") {\n\t\t\tconst frag = event.data.chunk.text ?? "";\n\t\t\tif (frag === "") return;\n\t\t\tio.stdout.write("<<<FC_REASONING_STREAM>>>" + JSON.stringify(frag) + "\\n");\n\t\t}\n\t\tif (event.type === "assistant/message") {\n\t\t\tfor (const block of event.data?.message?.content ?? []) {\n\t\t\t\tif (block.type === "tool-call") {\n\t\t\t\t\tio.stdout.write("<<<FC_TOOL_CALL>>>" + JSON.stringify({ name: block.name ?? "", arguments: block.arguments ?? "" }) + "\\n");\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t});\n\tagent.followup(createUserMessage({',
  },
  {
    // 2c. run：同一订阅里输出工具执行结果（开发团队"怎么说"：已完成/测试通过等）
    marker: '<<<FC_TOOL_RESULT>>>',
    old: '\t\tif (event.type === "assistant/message") {\n\t\t\tfor (const block of event.data?.message?.content ?? []) {\n\t\t\t\tif (block.type === "tool-call") {\n\t\t\t\t\tio.stdout.write("<<<FC_TOOL_CALL>>>" + JSON.stringify({ name: block.name ?? "", arguments: block.arguments ?? "" }) + "\\n");\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t});\n\tagent.followup(createUserMessage({',
    new: '\t\tif (event.type === "assistant/message") {\n\t\t\tfor (const block of event.data?.message?.content ?? []) {\n\t\t\t\tif (block.type === "tool-call") {\n\t\t\t\t\tio.stdout.write("<<<FC_TOOL_CALL>>>" + JSON.stringify({ name: block.name ?? "", arguments: block.arguments ?? "" }) + "\\n");\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t\tif (event.type === "tool/result") {\n\t\t\tconst text = (event.data?.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").slice(0, 200);\n\t\t\tif (text !== "") io.stdout.write("<<<FC_TOOL_RESULT>>>" + JSON.stringify(text) + "\\n");\n\t\t}\n\t});\n\tagent.followup(createUserMessage({',
  },
  {
    // 3. run：结束前输出完整推理信封（供持久化）
    marker: '<<<FC_REASONING_START>>>',
    old: '\tconst outcome = summarize(agent.session.events, firstSeq);\n\tio.stdout.write(outcome.text + "\\n");',
    new: '\tconst outcome = summarize(agent.session.events, firstSeq);\n\t// FreeCoder patch: emit reasoning envelope before the final text\n\tif (outcome.reasoning !== "") {\n\t\tio.stdout.write("<<<FC_REASONING_START>>>\\n" + outcome.reasoning + "\\n<<<FC_REASONING_END>>>\\n");\n\t}\n\tio.stdout.write(outcome.text + "\\n");',
  },
];

/** 解析 headless runner 文件路径（默认 DSH_HOME=~/.dsh） */
export function headlessRunnerPath(): string | null {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const p = path.join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-headless', 'lib', 'index.js');
  return fs.existsSync(p) ? p : null;
}

/**
 * 幂等应用 headless runner 补丁（按标记逐块，可增量升级）。
 * @returns 'patched' | 'already' | 'skipped'（结构不匹配或文件缺失）
 */
export function ensureHeadlessRunnerPatched(): 'patched' | 'already' | 'skipped' {
  const file = headlessRunnerPath();
  if (!file) return 'skipped';
  try {
    let src = fs.readFileSync(file, 'utf-8');
    let changed = false;
    for (const p of PATCHES) {
      if (src.includes(p.marker)) continue;
      if (!src.includes(p.old)) {
        console.warn(
          `[FreeCoder] headless runner 结构与预期不符，跳过补丁块（DSH 版本可能已更新）：${p.marker.slice(0, 40)}`,
        );
        continue;
      }
      src = src.split(p.old).join(p.new);
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(file, src, 'utf-8');
      console.log('[FreeCoder] 已更新 headless runner 补丁（推理流/开发进度流）');
      return 'patched';
    }
    return 'already';
  } catch (error) {
    console.warn('[FreeCoder] headless runner 补丁失败：', error);
    return 'skipped';
  }
}
