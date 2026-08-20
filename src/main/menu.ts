import { Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * 安装应用菜单。
 * - Windows / Linux：完全移除菜单栏（与 DeepSeek Harness 等现代应用一致）。
 *   剪贴板快捷键（Ctrl+C/X/V/A）在 window.ts 的 before-input-event 中恢复。
 * - macOS：保留系统标准菜单（App / 编辑 / 窗口），符合平台惯例且提供 Cmd+C/V 等快捷键。
 */
export function installAppMenu(): void {
  if (process.platform === 'darwin') {
    const template: MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }
  Menu.setApplicationMenu(null);
}
