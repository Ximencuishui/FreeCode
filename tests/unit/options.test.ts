import { parseOptions } from '../../src/renderer/utils/options';

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
