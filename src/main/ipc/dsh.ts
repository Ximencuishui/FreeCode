import { BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/types/ipc';
import type { DSHService } from '../dsh/service';
import type { DSHState } from '../../shared/types/dsh';
import { handleIpc } from './helpers';

/**
 * dsh 域 IPC（方案 3 落地：实时把 dsh 状态推到状态栏）。
 *
 * 通道设计：
 *  - dsh:state         invoke → 返回一次 DSHState 快照（渲染端首次挂载拉一次）
 *  - dsh:state-change  main → renderer 单向 send 推流（状态机变化时推送）
 *
 * 没有"订阅握手"：注册时主进程马上订阅 dsh.onStateChange 并向所有窗口推，
 * 渲染端 mount 时调一次 state() 拿到当前快照，之后通过 onStateChange 收推流。
 * 这避免了双重订阅去重 / 句柄清理等复杂逻辑——dsh 状态本身是低频事件
 * （每个任务仅推 2~3 次），重复广播几个窗口带来的开销可以忽略。
 *
 * 鲁棒性：webContents.isDestroyed / win.isDestroyed 时停止 send，避免主进程抛错。
 */
export function registerDshIpc(dsh: DSHService): void {
  handleIpc<undefined, DSHState>(IpcChannels.dshState, () => dsh.getState());

  // 一注册就把 dsh 状态接到所有窗口的 webContents 上，状态变更时直接推送。
  // 推流是无状态的（每个窗口一份回调），窗口关闭后回调因 isDestroyed 守卫自动沉默。
  dsh.onStateChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const wc = win.webContents;
      if (!wc || wc.isDestroyed()) continue;
      // send 不会抛错（如果 renderer 没在 listen，IPC 层会 no-op 不影响主进程）
      wc.send(IpcChannels.dshStateChange, state);
    }
  });
}
