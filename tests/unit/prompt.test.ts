import {
  buildAssistantTask,
  buildModifyTask,
  buildDevelopmentTask,
  buildVersionPlanTask,
} from '../../src/main/dsh/prompt';
import type { Requirements } from '../../src/main/storage/types';
import type { VersionPlan } from '../../src/shared/types/project';

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
    expect(task).toContain('个人收支记录工具');
  });

  it('buildDevelopmentTask：说明内置登录与数据集成（FreeCoderAuth）', () => {
    const task = buildDevelopmentTask(requirements);
    expect(task).toContain('auth.js');
    expect(task).toContain('FreeCoderAuth.init');
    expect(task).toContain('FreeCoderAuth.requireLogin');
    expect(task).toContain('FreeCoderAuth.data');
    expect(task).toContain('不要使用 localStorage');
    expect(task).toContain('不要修改或删除 auth.js、server.js');
  });

  it('buildDevelopmentTask：authentication=none 走本地模式，不引入 auth.js、改用 localStorage', () => {
    const task = buildDevelopmentTask({ ...requirements, authentication: 'none' });
    // 本地模式不应出现登录模式专属的 SDK 具体方法调用（泛指 FreeCoderAuth.* 不算）
    expect(task).not.toContain('FreeCoderAuth.init');
    expect(task).not.toContain('FreeCoderAuth.requireLogin');
    expect(task).not.toContain('FreeCoderAuth.data');
    expect(task).not.toContain('FreeCoderAuth.isLoggedIn');
    expect(task).not.toContain('FreeCoderAuth.logout');
    // 不应出现「按以下方式集成」这种登录模式说明
    expect(task).not.toContain('请按以下方式集成');
    // 本地模式提供 localStorage 模板 + 反向禁令
    expect(task).toContain('localStorage');
    expect(task).toContain('不要引入');
    expect(task).toContain('不要在代码里调用');
    expect(task).toContain('本地模式');
  });

  it('buildDevelopmentTask：authentication=password 仍走登录模式', () => {
    const task = buildDevelopmentTask({ ...requirements, authentication: 'password' });
    expect(task).toContain('auth.js');
    expect(task).toContain('FreeCoderAuth.init');
    expect(task).not.toContain('本地模式');
  });

  it('buildDevelopmentTask：有版本计划时只开发 V1 子集', () => {
    const plan: VersionPlan = {
      versions: [
        { label: 'V1', description: '先能记账', features: ['记录收支'] },
        { label: 'V2', description: '看得更明白', features: ['分类统计'] },
      ],
    };
    const task = buildDevelopmentTask(requirements, plan);
    expect(task).toContain('记录收支');
    expect(task).toContain('只开发 V1');
    // V2 功能不应进入本次开发范围
    expect(task).not.toContain('分类统计');
  });

  it('buildVersionPlanTask：包含需求与 MVP 切分要求', () => {
    const task = buildVersionPlanTask(requirements);
    expect(task).toContain('产品经理');
    expect(task).toContain('最小可用版本');
    expect(task).toContain('记录收支');
    expect(task).toContain('versions');
  });
});
