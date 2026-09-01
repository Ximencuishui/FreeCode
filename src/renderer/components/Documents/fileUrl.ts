/**
 * 把本地绝对路径转换为 file:// URL（用于复制到剪贴板 / 在浏览器打开等场景）。
 * - Windows: `C:\\Users\\foo\\bar.svg` → `file:///C:/Users/foo/bar.svg`
 * - Unix:    `/Users/foo/bar.svg`     → `file:///Users/foo/bar.svg`
 * - Windows 盘符的冒号不被编码（标准 RFC 8089 要求 `file:///C:/...` 而非 `C%3A`）
 * - 其他路径段单独 encodeURIComponent，避免空格 / 中文 / 特殊字符破坏 URL。
 */
export function toFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  const windowsDriveMatch = normalized.match(/^([A-Za-z]:)(.*)$/);
  if (windowsDriveMatch) {
    // Windows: 保留 `C:` 原样，只对后续路径段编码
    const drive = windowsDriveMatch[1];
    const rest = windowsDriveMatch[2];
    const encodedRest = rest.split('/').map(encodeURIComponent).join('/');
    return `file:///${drive}${encodedRest}`;
  }
  // Unix 绝对路径：直接对每段编码
  return 'file://' + normalized.split('/').map(encodeURIComponent).join('/');
}
