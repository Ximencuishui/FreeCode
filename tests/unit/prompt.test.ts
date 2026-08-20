import { buildAssistantTask, buildModifyTask, buildDevelopmentTask } from '../../src/main/dsh/prompt';
import type { Requirements } from '../../src/main/storage/types';

const requirements: Requirements = {
  projectId: 'p1',
  version: '1.0',
  confirmed: true,
  goal: '个人收支记录工具',
  targetUsers: '个人使用',
  coreFeatures: ['记录收支', '分类统计'],
  visualStyle: '简洁',
  platform: 'web',
  history: [],
  updatedAt: new Date().toISOString(),
};

describe('对话任务构建（prompt）', () => {
  it('buildAssistantTask：包含系统提示、历史与用户消息', () => {
    const task = buildAssistantTask({
      message: '我想做个记账工具',
      history: [
        {
          id: '1',
          role: 'user',
          content: '你好',
          timestamp: '2026-08-19T00:00:00.000Z',
          isComplete: true,
        },
        {
          id: '2',
          role: 'assistant',
          content: '您好！',
          timestamp: '2026-08-19T00:00:01.000Z',
          isComplete: true,
        },
      ],
      requirements,
    });

    expect(task).toContain('产品需求分析师');
    expect(task).toContain('我想做个记账工具');
    expect(task).toContain('你好');
    expect(task).toContain('个人收支记录工具');
  });

  it('buildModifyTask：包含修改指令与选中元素上下文', () => {
    const task = buildModifyTask(
      '标题颜色太深了',
      {
        tag: 'h1',
        selector: 'h1.title',
        content: '欢迎',
        styles: { color: '#1A2B3C', fontSize: '32px' },
        position: { x: 0, y: 0, width: 100, height: 30 },
      },
      requirements,
    );

    expect(task).toContain('标题颜色太深了');
    expect(task).toContain('h1.title');
    expect(task).toContain('#1A2B3C');
    expect(task).toContain('直接编辑现有文件');
  });

  it('buildModifyTask：无选中元素时提示判断目标', () => {
    const task = buildModifyTask('把按钮变大', undefined, requirements);
    expect(task).toContain('把按钮变大');
    expect(task).toContain('没有指定具体元素');
  });

  it('buildDevelopmentTask：包含需求与静态应用要求', () => {
    const task = buildDevelopmentTask(requirements);
    expect(task).toContain('全栈开发工程师');
    expect(task).toContain('index.html');
    expect(task).toContain('localStorage');
    expect(task).toContain('个人收支记录工具');
  });
});
