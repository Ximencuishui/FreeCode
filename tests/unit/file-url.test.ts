/** @jest-environment node */
import { toFileUrl } from '../../src/renderer/components/Documents/fileUrl';

describe('toFileUrl：本地绝对路径 → file:// URL', () => {
  it('Windows 盘符路径转换为 file:///C:/... 三斜杠格式', () => {
    expect(toFileUrl('C:\\Users\\foo\\bar.svg')).toBe('file:///C:/Users/foo/bar.svg');
    expect(toFileUrl('D:\\projects\\logo.png')).toBe('file:///D:/projects/logo.png');
  });

  it('Windows 路径若已用正斜杠也按盘符规则处理', () => {
    expect(toFileUrl('C:/Users/foo/bar.svg')).toBe('file:///C:/Users/foo/bar.svg');
  });

  it('Unix 绝对路径使用 file:// 双斜杠 + 原路径', () => {
    expect(toFileUrl('/Users/foo/bar.svg')).toBe('file:///Users/foo/bar.svg');
    expect(toFileUrl('/home/dev/projects/logo.png')).toBe(
      'file:///home/dev/projects/logo.png',
    );
  });

  it('路径段中的空格 / 中文 / 特殊字符按 URL 规则编码', () => {
    expect(toFileUrl('C:\\Users\\张三\\My Project\\logo.svg')).toBe(
      'file:///C:/Users/%E5%BC%A0%E4%B8%89/My%20Project/logo.svg',
    );
    expect(toFileUrl('/home/张三/项目/logo.svg')).toBe(
      'file:///home/%E5%BC%A0%E4%B8%89/%E9%A1%B9%E7%9B%AE/logo.svg',
    );
  });

  it('不编码斜杠本身（保持目录结构）', () => {
    const result = toFileUrl('/a/b/c.svg');
    // Unix 路径转换为 file:///a/b/c.svg，split 后为 ['file:', '', '', 'a', 'b', 'c.svg']
    expect(result.split('/').slice(0, 3)).toEqual(['file:', '', '']);
    expect(result).toContain('/a/b/c.svg');
  });
});
