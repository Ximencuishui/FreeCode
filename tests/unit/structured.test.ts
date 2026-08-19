import { tryExtractJson, tryParseRequirements, toRequirements } from '../../src/main/dsh/structured';

/**
 * 需求结构化解析单元测试（测试计划 4.2.2 UT-REQ-001~004）。
 */
describe('需求结构化解析（UT-REQ）', () => {
  it('UT-REQ-001 完整需求生成：解析出全部字段', () => {
    const reply = JSON.stringify({
      project_name: '我的记账本',
      goal: '个人使用的收支记录工具',
      target_users: '个人使用',
      core_features: ['记录收支', '分类统计'],
      use_scenarios: '每天记录消费',
      data_requirements: ['金额', '分类'],
      visual_style: '简洁清爽',
      platform: 'web',
    });
    const parsed = tryParseRequirements(reply);
    expect(parsed).not.toBeNull();
    expect(parsed?.project_name).toBe('我的记账本');
    expect(parsed?.goal).toBe('个人使用的收支记录工具');
    expect(parsed?.core_features).toEqual(['记录收支', '分类统计']);
    expect(parsed?.platform).toBe('web');
  });

  it('UT-REQ-002 部分信息缺失：缺可选字段不报错，缺核心字段返回 null', () => {
    // 缺 visual_style：仍可解析
    const partial = tryParseRequirements(
      JSON.stringify({ goal: '目标', target_users: '用户', core_features: ['功能'] }),
    );
    expect(partial).not.toBeNull();
    expect(partial?.visual_style).toBeUndefined();

    // 缺核心字段（goal）：返回 null（需求未收敛，继续对话）
    const missingCore = tryParseRequirements(
      JSON.stringify({ target_users: '用户', core_features: ['功能'] }),
    );
    expect(missingCore).toBeNull();
  });

  it('UT-REQ-003 JSON 代码块提取：```json 包裹也可解析', () => {
    const reply = '好的，需求已明确：\n```json\n{"goal":"目标","target_users":"用户","core_features":["功能"]}\n```\n请确认';
    const parsed = tryParseRequirements(reply);
    expect(parsed?.goal).toBe('目标');
  });

  it('UT-REQ-004 非 JSON 回复：返回 null，不误判', () => {
    expect(tryParseRequirements('您好！请告诉我谁会使用这个应用呢？')).toBeNull();
    expect(tryParseRequirements('')).toBeNull();
    expect(tryExtractJson('普通文本')).toBeNull();
  });

  it('toRequirements：映射为存储层格式', () => {
    const parsed = tryParseRequirements(
      JSON.stringify({ goal: '目标', target_users: '用户', core_features: ['功能'], visual_style: '简约' }),
    );
    const req = toRequirements('proj-1', parsed!);
    expect(req.projectId).toBe('proj-1');
    expect(req.confirmed).toBe(false);
    expect(req.coreFeatures).toEqual(['功能']);
    expect(req.history).toHaveLength(1);
  });
});
