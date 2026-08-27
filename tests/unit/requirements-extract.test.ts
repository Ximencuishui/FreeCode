import { extractRequirementJson } from '../../src/renderer/utils/requirements';

describe('需求收敛提取（extractRequirementJson）', () => {
  it('从「结束语 + json 代码块 + 引导语」中提取需求 JSON', () => {
    const content =
      '好的！你的需求我已经整理清楚了，请确认右侧的「需求卡片」～\n\n' +
      '```json\n{"goal":"记账工具","target_users":"个人","core_features":["记录收支"],"pages":["首页"]}\n```\n\n' +
      '确认后我就开始帮你规划开发步骤。';
    const r = extractRequirementJson(content);
    expect(r.json).not.toBeNull();
    expect(r.json?.goal).toBe('记账工具');
    expect(r.json?.core_features).toEqual(['记录收支']);
    expect(r.cleaned).toContain('请确认右侧的「需求卡片」');
    expect(r.cleaned).toContain('确认后我就开始帮你规划开发步骤');
    expect(r.cleaned).not.toContain('```json');
  });

  it('非收敛消息（无核心字段）返回 null', () => {
    const r = extractRequirementJson('普通的对话回复，没有需求 JSON。');
    expect(r.json).toBeNull();
    expect(r.cleaned).toBe('普通的对话回复，没有需求 JSON。');
  });

  it('JSON 缺少核心字段时视为未收敛', () => {
    const r = extractRequirementJson('{"goal":"只有目标"}');
    expect(r.json).toBeNull();
  });
});
