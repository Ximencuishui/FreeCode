import { Menu, shell, type MenuItemConstructorOptions } from 'electron';

/** 创建应用菜单（后续版本按需扩展业务菜单） */
export function createAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: '帮助',
      submenu: [
        {
          label: '项目主页',
          click: () => void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness'),
        },
        { role: 'about' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
