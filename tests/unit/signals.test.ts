import { translateSignal } from '../../src/main/dsh/translator';

/**
 * 信号翻译器单元测试（测试计划 4.2.1 UT-SIG-001~004）。
 */
describe('信号翻译器（UT-SIG）', () => {
  it('UT-SIG-001 匹配数据库信号：翻译为用户友好的 question 消息', () => {
    const result = translateSignal('[Agent] 检测到数据库需求，请提供连接信息');
    expect(result.type).toBe('question');
    expect(result.message).toContain('保存数据');
    expect(result.suggestions).toContain('使用本地 SQLite');
  });

  it('UT-SIG-002 匹配错误信号：翻译为 error 消息', () => {
    const result = translateSignal('[Agent] 错误：ECONNREFUSED');
    expect(result.type).toBe('error');
    expect(result.message).toContain('小状况');
    expect(result.autoAction).toBe('retry');
  });

  it('UT-SIG-003 未知信号降级：返回 info 且保留原始信息', () => {
    const result = translateSignal('[Agent] 未知技术信息xyz');
    expect(result.type).toBe('info');
    expect(result.message).toContain('[技术信息]');
  });

  it('UT-SIG-004 信号脱敏：输出中不包含 API Key 明文', () => {
    const result = translateSignal('[Agent] 错误：API Key sk-abcdef1234567890ABCDEF 无效');
    expect(JSON.stringify(result)).not.toContain('sk-abcdef1234567890ABCDEF');
    expect(JSON.stringify(result)).toContain('[API_KEY_REDACTED]');
  });
});
