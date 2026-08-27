import os from 'node:os';
import path from 'node:path';
import {
  DSHService,
  detectApiError,
  extractJsonLineToolCalls,
  extractLastReply,
  extractProgressUpdates,
  friendlyApiMessage,
  friendlyShellError,
  parseDshOutput,
  resolveDshLaunch,
} from '../../src/main/dsh/service';

/**
 * DSH 服务层单元测试：用 fake-dsh 夹具模拟 headless 行为。
 */

const FAKE_DSH = path.join(__dirname, 'fixtures', 'fake-dsh.js');

describe('DSH 服务层', () => {
  it('extractLastReply：提取 stdout 最后一条非空文本行', () => {
    expect(extractLastReply('第一行\n\n第二行\n')).toBe('第二行');
    expect(extractLastReply('   \n')).toBe('');
    expect(extractLastReply('你好')).toBe('你好');
  });

  it('parseDshOutput：解析推理信封与最终回复', () => {
    const out = '<<<FC_REASONING_START>>>\n先想一下\n再想一下\n<<<FC_REASONING_END>>>\n最终回复';
    const r = parseDshOutput(out);
    expect(r.reasoning).toBe('先想一下\n再想一下');
    expect(r.reply).toBe('最终回复');
  });

  it('parseDshOutput：多行回复完整保留（含推理流标记行被剔除）', () => {
    const out =
      '<<<FC_REASONING_STREAM>>>"片段1"\n' +
      '<<<FC_REASONING_START>>>\n' +
      '推理过程\n' +
      '<<<FC_REASONING_END>>>\n' +
      '方案一：xxx\n' +
      '方案二：yyy\n' +
      '方案三：zzz';
    const r = parseDshOutput(out);
    expect(r.reasoning).toBe('推理过程');
    expect(r.reply).toBe('方案一：xxx\n方案二：yyy\n方案三：zzz');
  });

  it('parseDshOutput：无信封时回退为最后一行，推理为空', () => {
    const r = parseDshOutput('第一行\n第二行');
    expect(r.reply).toBe('第二行');
    expect(r.reasoning).toBeUndefined();
  });

  /** 噪音过滤：DSH 透传大模型 API 错误到 stdout 时，不能当作正常回复展示给用户 */
  describe('detectApiError / 噪音过滤', () => {
    /** 生产环境观测到的典型错误输出 */
    const rateLimitLine =
      'sh: RATE_LIMIT: 429 {"type":"error","error":{"type":"rate_limit_error","message":"已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。 (2056)"},"request_id":"06df31a6cb1e731133010c392d89aee3"}';

    it('detectApiError：dsh shell 标签包裹的错误被识别为 RATE_LIMIT，返回友好中文提示', () => {
      const err = detectApiError(rateLimitLine);
      expect(err).not.toBeNull();
      expect(err?.code).toBe('RATE_LIMIT');
      expect(err?.message).toContain('速率/额度限制');
      expect(err?.message).toContain('设置');
      // 不应直接把 shell 标签 / 原始 JSON 透传给用户
      expect(err?.message).not.toContain('sh: RATE_LIMIT');
      expect(err?.message).not.toContain('request_id');
      expect(err?.message).not.toContain('{"type"');
    });

    it('detectApiError：直接是 Anthropic 错误 JSON（无 sh: 前缀）也能识别', () => {
      const pure = '{"type":"error","error":{"type":"rate_limit_error","message":"rate limit exceeded"}}';
      const err = detectApiError(pure);
      expect(err?.code).toBe('RATE_LIMIT');
      expect(err?.message).toContain('速率/额度限制');
    });

    it('detectApiError：退化的 429 + RATE_LIMIT 关键字也能识别', () => {
      const err = detectApiError('request failed: RATE_LIMIT, HTTP 429 returned');
      expect(err?.code).toBe('RATE_LIMIT');
    });

    it('detectApiError：普通回复不会被误判', () => {
      expect(detectApiError('你好，我来帮您配置')).toBeNull();
      expect(detectApiError('好的，文件已写入 index.html')).toBeNull();
      expect(detectApiError('')).toBeNull();
      // 包含数字 429 但不是错误（如端口号等）应不被误判
      expect(detectApiError('请访问 http://localhost:4290 查看效果')).toBeNull();
    });

    it('friendlyShellError：RATE_LIMIT 标签输出包含 HTTP 状态码', () => {
      const msg = friendlyShellError('sh: RATE_LIMIT: 429 some body');
      expect(msg).toContain('HTTP 429');
      expect(msg).toContain('some body');
    });

    it('friendlyApiMessage：认证错误（401/403）提示检查 API Key', () => {
      const msg = friendlyApiMessage('Invalid API key', 'full body');
      expect(msg).toContain('API Key');
    });

    it('friendlyApiMessage：未匹配任何已知模式时给出通用提示', () => {
      const msg = friendlyApiMessage('unknown weird thing', 'unknown weird thing');
      expect(msg).toContain('大模型 API 返回了错误');
    });
  });

  it('extractProgressUpdates：解析实时推理增量与工具调用（JSON 编码行）', () => {
    const chunks =
      'prefix\n<<<FC_REASONING_STREAM>>>"片段A"\n<<<FC_TOOL_CALL>>>{"name":"write_file","arguments":"{\\"path\\":\\"index.html\\"}"}\nsuffix';
    const updates = extractProgressUpdates(chunks);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({ kind: 'reasoning', text: '片段A' });
    expect(updates[1].kind).toBe('tool');
    expect(JSON.parse(updates[1].text)).toMatchObject({ name: 'write_file' });
    expect(extractProgressUpdates('无标记')).toEqual([]);
  });

  /** JSON 行兜底识别：适配 dsh 上游未打补丁（不写 <<<FC_TOOL_CALL>>>）的场景。
   *  模型输出里独立一行的工具调用 JSON 应被识别为 tool，下游 toolProgressLabel 可渲染。
   */
  describe('extractJsonLineToolCalls（JSON 行兜底识别）', () => {
    it('FreeCoder 协议 {name, arguments} 被识别为 tool', () => {
      const line = '{"name":"write_file","arguments":"{\\"path\\":\\"index.html\\"}"}';
      const updates = extractJsonLineToolCalls(line);
      expect(updates).toHaveLength(1);
      expect(updates[0].kind).toBe('tool');
      const tc = JSON.parse(updates[0].text) as { name: string; arguments: string };
      expect(tc.name).toBe('write_file');
      expect(tc.arguments).toContain('index.html');
    });

    it('arguments 为对象时序列化为 JSON 字符串（保持 toolProgressLabel 期望的 string 形态）', () => {
      const line = '{"name":"write","arguments":{"path":"app.js","content":"..."}}';
      const updates = extractJsonLineToolCalls(line);
      expect(updates).toHaveLength(1);
      const args = JSON.parse(updates[0].text).arguments as string;
      expect(typeof args).toBe('string');
      expect(JSON.parse(args)).toMatchObject({ path: 'app.js' });
    });

    it('Anthropic 协议 {type:"tool_use", name, input} 被识别，input → arguments', () => {
      const line = '{"type":"tool_use","name":"bash","input":{"command":"npm test"}}';
      const updates = extractJsonLineToolCalls(line);
      expect(updates).toHaveLength(1);
      const tc = JSON.parse(updates[0].text) as { name: string; arguments: string };
      expect(tc.name).toBe('bash');
      expect(JSON.parse(tc.arguments)).toMatchObject({ command: 'npm test' });
    });

    it('OpenAI 协议 {function:{name, arguments}} 被识别', () => {
      const line = '{"function":{"name":"edit","arguments":"{\\"path\\":\\"app.js\\"}"}}';
      const updates = extractJsonLineToolCalls(line);
      expect(updates).toHaveLength(1);
      expect(JSON.parse(updates[0].text).name).toBe('edit');
    });

    it('未知工具名（纯数据 JSON 如 {"name":"production"}）不被误识别', () => {
      // 避免模型回复里出现的数据 JSON 被当作 tool call
      const line = '{"name":"production","arguments":"some_value"}';
      expect(extractJsonLineToolCalls(line)).toHaveLength(0);
    });

    it('缺 arguments 字段不被识别（不符合工具调用必备结构）', () => {
      const line = '{"name":"write","path":"app.js"}';
      expect(extractJsonLineToolCalls(line)).toHaveLength(0);
    });

    it('嵌入在文本里的 JSON（不以 { 或 [ 开头）不被识别', () => {
      // 避免模型回复"返回结果：{...}"这类场景被误识别
      const line = '返回结果：{"name":"write","arguments":"x"}';
      expect(extractJsonLineToolCalls(line)).toHaveLength(0);
    });

    it('FC_* marker 行被跳过（避免与 prefix 扫描重复）', () => {
      const line = '<<<FC_TOOL_CALL>>>{"name":"write","arguments":"x"}';
      expect(extractJsonLineToolCalls(line)).toHaveLength(0);
    });

    it('普通中文文本行不被识别', () => {
      const line = '好的，我来帮您写文件';
      expect(extractJsonLineToolCalls(line)).toHaveLength(0);
    });

    it('不以 } 或 ] 结尾的半行 JSON 不被识别（避免与下个 stdio 缓冲合并前误识别）', () => {
      const line = '{"name":"write","arguments":"x"'; // 缺右括号
      expect(extractJsonLineToolCalls(line)).toHaveLength(0);
    });

    it('多行混合：FC marker + JSON 行 + 普通文本 都能识别且不重复', () => {
      const chunk = [
        '<<<FC_TOOL_CALL>>>{"name":"read","arguments":"x"}', // FC marker（prefix 扫描）
        '好的，正在分析文件结构',
        '{"name":"write","arguments":"{\\"path\\":\\"a.js\\"}"}', // 兜底扫描
        '<<<FC_TOOL_RESULT>>>"完成"', // FC marker（prefix 扫描）
      ].join('\n');
      const updates = extractProgressUpdates(chunk);
      // prefix 扫到 2 条（TOOL_CALL + TOOL_RESULT），JSON 行兜底扫到 1 条（write，且不会重复识别 FC_TOOL_CALL 那条）
      expect(updates.length).toBeGreaterThanOrEqual(3);
      const toolNames = updates
        .filter((u) => u.kind === 'tool')
        .map((u) => JSON.parse(u.text).name as string);
      expect(toolNames).toEqual(expect.arrayContaining(['read', 'write']));
      // 写只出现一次（不重复）
      expect(toolNames.filter((n) => n === 'write')).toHaveLength(1);
      // tool-result 只出现一次
      expect(updates.filter((u) => u.kind === 'tool-result')).toHaveLength(1);
    });

    /** 审计验收补足（风险 A）：KNOWN_TOOL_NAME_TOKENS 已去除过宽的 'test'/'run' 子串。
     *  以下为 word-boundary 防护验证：模型回复里出现含 test/run 子串但不是工具名的 JSON，
     *  不应被误识别为 tool call。
     */
    it('word-boundary 防误识别：含 "test" 子串的非测试工具名不被识别', () => {
      // 这些名字含 "test" 子串但不是测试工具（模型回复里常见的数据 JSON 模式）
      const lines = [
        '{"name":"test_result","arguments":{"status":"pass"}}',
        '{"name":"latest_test_data","arguments":{"ts":1234}}',
        '{"name":"contestant","arguments":"x"}', // 含 "test" 子串
      ];
      for (const line of lines) {
        expect(extractJsonLineToolCalls(line)).toEqual([]);
      }
    });

    it('word-boundary 防误识别：含 "run" 子串的非 run 工具名不被识别', () => {
      // 这些名字含 "run" 子串但不是命令行执行工具。需验证不误识别为 tool。
      // 注意：不能含 "search"/"write"/"edit" 等其他已知 token，否则会被那些 token 识别（这是另外的防护场景）。
      const lines = [
        '{"name":"dryrun_check","arguments":"x"}',
        '{"name":"runbook_link","arguments":"x"}',
        '{"name":"grundy_score","arguments":"x"}', // 含 "run" 子串（"grundy"）
      ];
      for (const line of lines) {
        expect(extractJsonLineToolCalls(line)).toEqual([]);
      }
    });

    it('大小写不敏感：工具名首字母大写（Write）也被识别', () => {
      const line = '{"name":"Write","arguments":{"path":"app.js"}}';
      const updates = extractJsonLineToolCalls(line);
      expect(updates).toHaveLength(1);
      // 原文保留（不强制小写），归一化比较在 isKnownToolName 里完成
      expect(JSON.parse(updates[0].text).name).toBe('Write');
    });

    it('空 chunk 返回空数组', () => {
      expect(extractJsonLineToolCalls('')).toEqual([]);
      expect(extractJsonLineToolCalls('\n\n\n')).toEqual([]);
    });
  });

  it('resolveDshLaunch：FREECODER_DSH_COMMAND JSON 数组优先', () => {
    const prev = process.env.FREECODER_DSH_COMMAND;
    try {
      process.env.FREECODER_DSH_COMMAND = JSON.stringify(['node', 'C:/bin/dsh.js']);
      const launch = resolveDshLaunch();
      expect(launch.source).toBe('env');
      expect(launch.argv).toEqual(['node', 'C:/bin/dsh.js']);
    } finally {
      if (prev === undefined) delete process.env.FREECODER_DSH_COMMAND;
      else process.env.FREECODER_DSH_COMMAND = prev;
    }
  });

  it('resolveDshLaunch：无自定义命令时解析为内置运行时（bundled），避免 PATH 脚本 ENOENT', () => {
    const prev = process.env.FREECODER_DSH_COMMAND;
    delete process.env.FREECODER_DSH_COMMAND;
    try {
      const launch = resolveDshLaunch();
      expect(launch.source).toBe('bundled');
      expect(launch.argv.length).toBe(2); // [内置 node.exe, bin.js]
      expect(require('node:fs').existsSync(launch.argv[0])).toBe(true);
      expect(require('node:fs').existsSync(launch.argv[1])).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.FREECODER_DSH_COMMAND;
      else process.env.FREECODER_DSH_COMMAND = prev;
    }
  });

  it('runTask：返回 headless 最终回复与退出码', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless'],
      apiKeyProvider: async () => ({ apiKey: 'sk-test-1234567890', provider: 'deepseek' }),
    });
    const result = await service.runTask(os.tmpdir(), '帮我生成一个文件');
    expect(result.exitCode).toBe(0);
    expect(result.reply).toBe('模拟回复：你好');
  });

  it('runTask：任务失败时退出码非零', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless', '--crash'],
      apiKeyProvider: async () => ({ apiKey: 'sk-test-1234567890', provider: 'deepseek' }),
    });
    const result = await service.runTask(os.tmpdir(), '失败任务');
    expect(result.exitCode).not.toBe(0);
  });

  it('runTask：未配置 API Key 时抛 DSHError(API_KEY_MISSING)（渲染层据此弹窗引导接入）', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless'],
      apiKeyProvider: async () => null,
    });
    await expect(service.runTask(os.tmpdir(), '任何任务')).rejects.toMatchObject({
      code: 'API_KEY_MISSING',
    });
  });

  it('runTask：dsh 命令不存在时抛 DSHError(DSH_START_FAILED)，不再产生未捕获异常', async () => {
    const service = new DSHService({
      command: ['no-such-dsh-binary-xyz'],
      apiKeyProvider: async () => ({ apiKey: 'sk-test-12345678', provider: 'deepseek' }),
    });
    await expect(service.runTask(os.tmpdir(), '任务')).rejects.toMatchObject({
      code: 'DSH_START_FAILED',
    });
  });

  it('runTask：deepseek 注入 DEEPSEEK_API_KEY，且输出中的 key 被脱敏', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless'],
      apiKeyProvider: async () => ({ apiKey: 'sk-a1b2c3d4e5f6g7h8i9j0', provider: 'deepseek' }),
    });
    const result = await service.runTask(os.tmpdir(), 'env-check');
    expect(result.exitCode).toBe(0);
    expect(result.reply).toContain('DEEPSEEK_API_KEY');
    expect(result.reply).not.toContain('sk-a1b2c3d4e5f6g7h8i9j0');
    expect(result.reply).toContain('[API_KEY_REDACTED]');
  });

  it('runTask：openai-compatible 注入 OPENAI_* 环境变量', async () => {
    const service = new DSHService({
      command: [process.execPath, FAKE_DSH, '--profile', 'headless'],
      apiKeyProvider: async () => ({
        apiKey: 'sk-openai-key-12345678',
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o-mini',
      }),
    });
    const result = await service.runTask(os.tmpdir(), 'env-check');
    expect(result.exitCode).toBe(0);
    expect(result.reply).toContain('OPENAI_API_KEY');
    expect(result.reply).toContain('https://api.example.com/v1');
    expect(result.reply).not.toContain('sk-openai-key-12345678');
  });
});
