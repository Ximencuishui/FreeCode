/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  SplitButtonMenu,
  type SplitButtonMenuOption,
} from '../../src/renderer/components/common/SplitButtonMenu';

type Mode = 'a' | 'b' | 'c';

const OPTIONS: ReadonlyArray<SplitButtonMenuOption<Mode>> = [
  { key: 'a', label: '选项 A', description: '第一个选项' },
  { key: 'b', label: '选项 B', description: '第二个选项', icon: '⭐' },
  { key: 'c', label: '选项 C', description: '第三个选项' },
];

describe('SplitButtonMenu（通用 split button 组件）', () => {
  it('渲染主按钮（默认显示当前选项 label）+ ▾ 切换按钮', () => {
    render(
      <SplitButtonMenu
        value="b"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        toggleAriaLabel="切换选项"
      />,
    );
    // 主按钮显示当前激活选项的 label
    expect(screen.getByRole('button', { name: /选项 B/ })).toBeTruthy();
    // 切换按钮
    expect(screen.getByRole('button', { name: '切换选项' })).toBeTruthy();
  });

  it('菜单默认关闭：role=menu 不存在', () => {
    render(
      <SplitButtonMenu value="a" options={OPTIONS} onMainClick={() => {}} onSelect={() => {}} />,
    );
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('点击 ▾ 打开菜单：role=menu 出现，aria-expanded=true，列出所有选项', () => {
    render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        toggleAriaLabel="切换"
      />,
    );
    const toggle = screen.getByRole('button', { name: '切换' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const menu = screen.getByRole('menu');
    expect(menu).toBeTruthy();
    // 切换按钮的 aria-expanded 现在是 true
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // 菜单列出三个 menuitemradio
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);
  });

  it('再次点击 ▾ 关闭菜单', () => {
    render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        toggleAriaLabel="切换"
      />,
    );
    const toggle = screen.getByRole('button', { name: '切换' });
    fireEvent.click(toggle);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('点击菜单项触发 onSelect(key) 并自动关闭菜单', () => {
    const onSelect = jest.fn();
    render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={onSelect}
        toggleAriaLabel="切换"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '切换' }));
    // 点击"选项 B"
    const itemB = screen.getByRole('menuitemradio', { name: /选项 B/ });
    fireEvent.click(itemB);
    expect(onSelect).toHaveBeenCalledWith('b');
    // 菜单关闭
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('点击主按钮触发 onMainClick（caller 按当前 value 自行分发动作）', () => {
    const onMainClick = jest.fn();
    render(
      <SplitButtonMenu
        value="b"
        options={OPTIONS}
        onMainClick={onMainClick}
        onSelect={() => {}}
      />,
    );
    // 主按钮文本包含"选项 B"（默认渲染）
    fireEvent.click(screen.getByRole('button', { name: /选项 B/ }));
    expect(onMainClick).toHaveBeenCalledTimes(1);
  });

  it('外部点击关闭菜单', () => {
    render(
      <div>
        <button type="button">外部按钮</button>
        <SplitButtonMenu
          value="a"
          options={OPTIONS}
          onMainClick={() => {}}
          onSelect={() => {}}
          toggleAriaLabel="切换"
        />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: '切换' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    // 点击外部元素
    fireEvent.mouseDown(screen.getByText('外部按钮'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Esc 键关闭菜单', () => {
    render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        toggleAriaLabel="切换"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '切换' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('受控 value 决定哪个菜单项显示 ✓ + aria-checked=true', () => {
    render(
      <SplitButtonMenu
        value="b"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        toggleAriaLabel="切换"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '切换' }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items[0].getAttribute('aria-checked')).toBe('false');
    expect(items[1].getAttribute('aria-checked')).toBe('true');
    expect(items[2].getAttribute('aria-checked')).toBe('false');
  });

  it('renderMain 自定义主按钮渲染', () => {
    render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        renderMain={(active) => <span>自定义 · {active.label}</span>}
      />,
    );
    expect(screen.getByText('自定义 · 选项 A')).toBeTruthy();
  });

  it('renderOption 自定义菜单项渲染（覆盖默认的 label + description + ✓ 行为）', () => {
    render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        toggleAriaLabel="切换"
        renderOption={(option, active) => (
          <span>
            [{active ? '*' : ' '}] {option.label} :: {option.description}
          </span>
        )}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '切换' }));
    expect(screen.getByText('[*] 选项 A :: 第一个选项')).toBeTruthy();
    expect(screen.getByText('[ ] 选项 B :: 第二个选项')).toBeTruthy();
  });

  it('tone=success 给主按钮挂 emerald 色调类', () => {
    const { container } = render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        tone="success"
      />,
    );
    // 主按钮是第一个 <button>（toggle 是第二个）
    const mainButton = container.querySelector('button:not([aria-haspopup])');
    expect(mainButton?.className).toContain('bg-emerald-50');
    expect(mainButton?.className).toContain('text-emerald-600');
  });

  it('tone=error 给主按钮挂 rose 色调类', () => {
    const { container } = render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        tone="error"
      />,
    );
    const mainButton = container.querySelector('button:not([aria-haspopup])');
    expect(mainButton?.className).toContain('bg-rose-50');
    expect(mainButton?.className).toContain('text-rose-600');
  });

  it('menuPlacement=down 时菜单容器挂 top-full mt-1（向下展开）', () => {
    render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        menuPlacement="down"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '切换选项' }));
    const menu = screen.getByRole('menu');
    expect(menu.className).toContain('top-full');
    expect(menu.className).toContain('mt-1');
  });

  it('menuPlacement=up（默认）时菜单容器挂 bottom-full mb-1（向上展开）', () => {
    render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '切换选项' }));
    const menu = screen.getByRole('menu');
    expect(menu.className).toContain('bottom-full');
    expect(menu.className).toContain('mb-1');
  });

  it('value 不在 options 时 fallback 到第一个选项', () => {
    // @ts-expect-error 故意传入非法 value 测试 fallback
    render(
      <SplitButtonMenu
        value="zzz"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
      />,
    );
    // 主按钮显示第一个选项的 label
    expect(screen.getByRole('button', { name: /选项 A/ })).toBeTruthy();
  });

  it('实际业务场景：路径复制 split button（受控 + 受控持久化）', async () => {
    // 模拟 DocumentViewer 里的使用方式：受控 value + onSelect 立即按新值执行一次
    const user = userEvent.setup();
    const onSelect = jest.fn();
    function Demo() {
      const [mode, setMode] = useState<Mode>('a');
      return (
        <SplitButtonMenu
          value={mode}
          options={OPTIONS}
          onMainClick={() => {}}
          onSelect={(next) => {
            setMode(next);
            onSelect(next);
          }}
          renderMain={(active) => <span>复制 · {active.label}</span>}
          toggleAriaLabel="切换"
        />
      );
    }
    render(<Demo />);
    expect(screen.getByText('复制 · 选项 A')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '切换' }));
    await user.click(screen.getByRole('menuitemradio', { name: /选项 C/ }));
    expect(onSelect).toHaveBeenCalledWith('c');
    // 受控 value 切到 c 后，主按钮文案更新
    expect(screen.getByText('复制 · 选项 C')).toBeTruthy();
  });

  it('受控 value 切换后：renderMain 收到新的 activeOption（不依赖 onSelect 触发）', () => {
    // 用 key 强制 rerender 模拟 caller 直接更新 value 的场景（如 localStorage 同步回来）
    function Demo({ value }: { value: Mode }) {
      return (
        <SplitButtonMenu
          value={value}
          options={OPTIONS}
          onMainClick={() => {}}
          onSelect={() => {}}
          renderMain={(active) => <span>主区 · {active.label}</span>}
        />
      );
    }
    const { rerender } = render(<Demo value="a" />);
    expect(screen.getByText('主区 · 选项 A')).toBeTruthy();
    rerender(<Demo value="c" />);
    // value 改后，renderMain 立即反映新的 activeOption
    expect(screen.getByText('主区 · 选项 C')).toBeTruthy();
    expect(screen.queryByText('主区 · 选项 A')).toBeNull();
  });

  it('点击当前已选中的菜单项仍正常关闭菜单 + 回调', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(
      <SplitButtonMenu
        value="b"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={onSelect}
        toggleAriaLabel="切换"
      />,
    );
    await user.click(screen.getByRole('button', { name: '切换' }));
    // 当前 value 是 b，再点一次 b
    await user.click(screen.getByRole('menuitemradio', { name: /选项 B/ }));
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('连续多次开关菜单：每次都正确切换 open 状态', async () => {
    const user = userEvent.setup();
    render(
      <SplitButtonMenu
        value="a"
        options={OPTIONS}
        onMainClick={() => {}}
        onSelect={() => {}}
        toggleAriaLabel="切换"
      />,
    );
    const toggle = screen.getByRole('button', { name: '切换' });
    // 第 0 次点击 → 开；第 1 次 → 关；第 2 次 → 开；第 3 次 → 关
    for (let i = 0; i < 4; i += 1) {
      await user.click(toggle);
      const expectedOpen = i % 2 === 0;
      if (expectedOpen) {
        expect(screen.getByRole('menu')).toBeTruthy();
      } else {
        expect(screen.queryByRole('menu')).toBeNull();
      }
    }
  });
});
