import { extractQuestionBlocks, parseOptions } from '../../src/renderer/utils/options';

describe('选项解析（parseOptions）', () => {
  it('解析 A/B/C 选项', () => {
    const options = parseOptions('请选择：\nA. 个人使用\nB. 家庭共用\nC. 团队使用');
    expect(options).toHaveLength(3);
    expect(options[0]).toEqual({ key: 'A', label: '个人使用' });
    expect(options[2].label).toBe('团队使用');
  });

  it('少于 2 个选项时返回空（避免误解析）', () => {
    expect(parseOptions('普通的一句话。')).toEqual([]);
    expect(parseOptions('A. 唯一选项')).toEqual([]);
  });

  it('支持中文顿号与冒号分隔', () => {
    expect(parseOptions('A、个人使用\nB、家庭共用')).toHaveLength(2);
    expect(parseOptions('A：个人使用\nB：家庭共用')).toHaveLength(2);
  });
});

describe('问题卡片提取（extractQuestionBlocks）', () => {
  it('提取单个问题与选项', () => {
    const blocks = extractQuestionBlocks('好的，先确认目标。\n\n谁会用这个工具？\n请选择：\nA. 个人使用\nB. 家庭共用');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].question).toContain('谁会用这个工具？');
    expect(blocks[0].options).toHaveLength(2);
  });

  it('支持多个问题块（需求审查一次问多个矛盾点）：每组各带选项，问题互不吞并', () => {
    const blocks = extractQuestionBlocks(
      '问题1：目标里写了 A，但实现只能做 B。\n请选择：\nA. 接受\nB. 调整目标\n\n' +
        '问题2：没有设置页，密钥在哪填？\n请选择：\nA. 加设置页\nB. 首启引导\nC. 其他',
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].question).toContain('问题1');
    expect(blocks[0].options).toEqual([
      { key: 'A', label: '接受' },
      { key: 'B', label: '调整目标' },
    ]);
    expect(blocks[1].question).toContain('问题2');
    expect(blocks[1].options).toHaveLength(3);
  });

  it('支持 Options for 引导行', () => {
    const blocks = extractQuestionBlocks('Options for goal:\nA. 审计可见度\nB. 自动优化');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].question).toBe('请选择：');
    expect(blocks[0].options).toHaveLength(2);
  });

  it('无选项时返回空数组', () => {
    expect(extractQuestionBlocks('只是一个普通回复，没有任何选项。')).toEqual([]);
  });
});
