import { useEffect, useState } from 'react';
import type { DSHState } from '@shared/types/dsh';

/**
 * dsh 运行时状态订阅。
 *
 * - 初次挂载调一次 window.electron.dsh.state() 拉快照（避免显示空白态）
 * - 立刻订阅 window.electron.dsh.onStateChange，每次主进程聚合状态变化都更新
 * - 卸载时取消订阅，避免 setState on unmounted 警告
 *
 * INITIAL 用 status='loading' + available=false，让徽章在 IPC 往返期间显示骨架态，
 * 不会让用户看到"💤 休眠中"误以为已经 ready —— 等真实快照到达后再切到对应状态。
 * 拿不到状态（preload 还没好、IPC 失败等）时返回 INITIAL，避免渲染层抛错。
 */
const INITIAL: DSHState = {
  available: false,
  status: 'loading',
  busyCount: 0,
  message: 'dsh 状态加载中…',
};

export function useDshState(): DSHState {
  const [state, setState] = useState<DSHState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    // 拉一次快照（mount 时拿到真实当前态，覆盖 INITIAL）
    window.electron.dsh
      .state()
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch(() => {
        // 主进程调用失败（极少见，比如 IPC 通道未注册）→ 保留 INITIAL 不刷新
      });

    // 订阅后续状态变化
    const off = window.electron.dsh.onStateChange((next) => {
      if (!cancelled) setState(next);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return state;
}
