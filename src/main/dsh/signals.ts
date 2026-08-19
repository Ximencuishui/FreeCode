/**
 * 信号规则库（架构文档 4.2.2、PRD 2.1.4）。
 * 将 DSH 底层技术信号映射为用户友好的自然语言。
 */

export type SignalCategory = 'info' | 'warning' | 'error' | 'question';

export interface SignalRule {
  pattern: RegExp;
  category: SignalCategory;
  translate: (match: RegExpMatchArray) => {
    message: string;
    suggestions?: string[];
    /** 自动动作标识（如 'retry' 自动重试） */
    autoAction?: string;
  };
}

export const signalRules: SignalRule[] = [
  {
    pattern: /数据库|需要保存数据|连接数据库/i,
    category: 'question',
    translate: () => ({
      message: '您的项目需要保存数据，我来帮您配置本地数据库',
      suggestions: ['使用本地 SQLite', '稍后配置'],
    }),
  },
  {
    pattern: /error|错误|失败|出错|ECONNREFUSED|ETIMEDOUT|timeout|无法连接/i,
    category: 'error',
    translate: (match) => ({
      message: `遇到一点小状况：${match[0]}，正在自动处理…`,
      autoAction: 'retry',
    }),
  },
  {
    pattern: /构建|打包|build|编译/i,
    category: 'info',
    translate: () => ({
      message: '正在打包您的应用，请稍候…',
    }),
  },
  {
    pattern: /测试|验证|check/i,
    category: 'info',
    translate: () => ({
      message: '正在检查您的应用，确保一切正常…',
    }),
  },
];
