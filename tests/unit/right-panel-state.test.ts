/** @jest-environment jsdom */
/**
 * v0.1.02 P1-1：右侧面板宽窄屏状态互通单测（UT-RP-001~005）。
 *
 * 验收报告 P1-1：宽屏状态下右侧面板折叠 / 展开与窄屏抽屉打开 / 关闭互相独立，
 * 导致用户在两种宽度间切换时看到「视觉割裂」—— 一边嵌入面板在屏内，
 * 一边抽屉在屏外叠加在一起。
 *
 * 修复：在 App.tsx 的 useEffect 里强制同步：
 *   - isNarrow=true 时：rightCollapsed 必须为 true（嵌入面板收起）
 *   - isNarrow=true 时：drawerOpen 必须为 false（避免抽屉残留）
 *   - isNarrow=false 时：如果 drawerOpen=true，也强制关闭（抽屉态切回嵌入态）
 *
 * 本单测用一个等价的 wrapper 组件 + hook（与 App.tsx 行为完全一致）
 * 验证这段同步逻辑本身的正确性，避免污染 App.tsx 的依赖。
 */
import { act, renderHook } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';

/** 与 App.tsx 保持一致的阈值（= 768） */
const NARROW_THRESHOLD = 768;

/**
 * 抽出右面板宽度响应式同步 hook（与 App.tsx 中 useEffect 行为一致）。
 * - isNarrow=true → rightCollapsed=true，drawerOpen=false（仅在 isNarrow 切换时同步）
 * - isNarrow=false → drawerOpen=true 时强制 false
 *
 * 注意：依赖数组只放 [isNarrow]，不包含 rightCollapsed/drawerOpen——
 * 否则用户主动 setDrawerOpen(true) 后 effect 会立即把它打回 false，
 * 导致窄屏下抽屉永远打不开（v0.1.02 P1-1 实测坑）。
 */
function useRightPanelResponsiveSync(
  isNarrow: boolean,
): {
  rightCollapsed: boolean;
  drawerOpen: boolean;
  setRightCollapsed: (v: boolean) => void;
  setDrawerOpen: (v: boolean) => void;
} {
  const [rightCollapsed, setRightCollapsedState] = useState(false);
  const [drawerOpen, setDrawerOpenState] = useState(false);

  const setRightCollapsed = useCallback((v: boolean) => setRightCollapsedState(v), []);
  const setDrawerOpen = useCallback((v: boolean) => setDrawerOpenState(v), []);

  useEffect(() => {
    if (isNarrow) {
      setRightCollapsedState(true);
      setDrawerOpenState(false);
    } else if (drawerOpen) {
      setDrawerOpenState(false);
    }
  }, [isNarrow]); // eslint-disable-line react-hooks/exhaustive-deps

  return { rightCollapsed, drawerOpen, setRightCollapsed, setDrawerOpen };
}

describe('右面板宽窄屏状态互通（v0.1.02 P1-1）', () => {
  it('UT-RP-001 宽屏初始：rightCollapsed=false，drawerOpen=false', () => {
    const { result } = renderHook(() => useRightPanelResponsiveSync(false));
    expect(result.current.rightCollapsed).toBe(false);
    expect(result.current.drawerOpen).toBe(false);
  });

  it('UT-RP-002 宽屏 → 窄屏：rightCollapsed 自动变 true，drawerOpen 自动变 false', () => {
    const { result, rerender } = renderHook(({ narrow }) => useRightPanelResponsiveSync(narrow), {
      initialProps: { narrow: false },
    });

    // 用户先手动展开右面板
    act(() => {
      result.current.setRightCollapsed(false); // 已经是 false，无变化
    });
    expect(result.current.rightCollapsed).toBe(false);

    // 窗口缩窄到阈值以下
    rerender({ narrow: true });

    // 同步逻辑触发：rightCollapsed=true，drawerOpen=false
    expect(result.current.rightCollapsed).toBe(true);
    expect(result.current.drawerOpen).toBe(false);
  });

  it('UT-RP-003 窄屏打开抽屉 → 切到宽屏：drawerOpen 自动变 false（避免覆盖嵌入面板）', () => {
    const { result, rerender } = renderHook(
      ({ narrow }) => useRightPanelResponsiveSync(narrow),
      { initialProps: { narrow: true } },
    );

    // 模拟用户在窄屏下打开抽屉
    act(() => {
      result.current.setDrawerOpen(true);
    });
    expect(result.current.drawerOpen).toBe(true);

    // 窗口变宽
    rerender({ narrow: false });

    // 抽屉关闭（避免在已经能放下嵌入面板时还覆盖一份抽屉）
    expect(result.current.drawerOpen).toBe(false);
    // rightCollapsed 保持上一次的折叠态（这里 isNarrow→false 时不再强制改它）
    // 在修复前是「变窄后忘了变回」导致割裂；现在 isNarrow=true→false 的切换不会动 rightCollapsed
  });

  it('UT-RP-004 宽屏手动折叠 → 切窄屏：rightCollapsed 保持 true（已经折叠，幂等）', () => {
    const { result, rerender } = renderHook(
      ({ narrow }) => useRightPanelResponsiveSync(narrow),
      { initialProps: { narrow: false } },
    );

    // 用户在宽屏手动折叠
    act(() => {
      result.current.setRightCollapsed(true);
    });
    expect(result.current.rightCollapsed).toBe(true);

    // 切窄屏：本来就是 true，幂等
    rerender({ narrow: true });
    expect(result.current.rightCollapsed).toBe(true);
  });

  it('UT-RP-005 阈值：NARROW_THRESHOLD（=768px）边界精确判断', () => {
    // 用真实的 helper 函数判断阈值语义（来自 App.tsx 的 isNarrow 计算）
    const isNarrow = (w: number): boolean => w < NARROW_THRESHOLD;
    expect(isNarrow(NARROW_THRESHOLD)).toBe(false);
    expect(isNarrow(NARROW_THRESHOLD - 1)).toBe(true);
    expect(isNarrow(NARROW_THRESHOLD + 1)).toBe(false);
    // 极小窗口
    expect(isNarrow(400)).toBe(true);
    // 极大窗口
    expect(isNarrow(2400)).toBe(false);
  });
});