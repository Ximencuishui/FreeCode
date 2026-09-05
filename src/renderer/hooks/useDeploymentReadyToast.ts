import { useEffect, useRef } from 'react';
import { useChatStore } from '../store/chat';
import { useProjectStore } from '../store/project';
import { useUiStore } from '../store/ui';
import type { ProjectStatus } from '../../shared/types/project';

/**
 * P0 建议 3：「应用已就绪」边沿触发 hook。
 *
 * 监听 projectStatus 从 'developing' 跃迁到 'ready' / 'exported' 的瞬间，
 * 通过 ui store push 一条全局通知（含「去看部署」动作按钮）。
 *
 * 关键设计：
 *   - 边沿触发（false → true）而非状态值触发：
 *     用户已 ready 时切回项目不会重复刷通知；
 *     ready → exported 状态变化也会触发一次（导出成功后值得提醒）。
 *   - 跨项目隔离：用 useRef 记录「上一状态 + 当前项目 id」；
 *     项目 id 变化时强制重置（哪怕新项目状态也是 ready，也不算"刚变"）。
 *   - 用户已在 deploy 视图时不打扰（避免重复打扰）。
 *   - 自动消失 8 秒 + 手动 ✕ 双通道：信息半衰期短，没必要常驻。
 *   - 错误隔离：任何 store action 抛错都不影响主流程，仅 console.warn。
 *
 * 该 hook 在 App.tsx 顶层调用一次，不返回任何值。
 */
export function useDeploymentReadyToast(): void {
  const projectStatus = useChatStore((s) => s.projectStatus);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const currentView = useUiStore((s) => s.currentView);
  const pushNotification = useUiStore((s) => s.pushNotification);
  const setView = useUiStore((s) => s.setView);

  // 用 ref 记录「上一状态 + 上一项目 id」做边沿检测；用 ref 而非 state 避免触发额外渲染
  const prevRef = useRef<{ status: ProjectStatus | null; projectId: string | null }>({
    status: null,
    projectId: null,
  });

  useEffect(() => {
    const prev = prevRef.current;
    // 项目切换：只更新 ref，不触发 toast（哪怕新项目是 ready，也不算"刚变"）
    if (prev.projectId !== currentProjectId) {
      prevRef.current = { status: projectStatus, projectId: currentProjectId };
      return;
    }

    // 边沿触发：developing → ready / exported 是主路径；ready → exported 是次级边沿
    // （导出成功后值得提醒一次）。其他状态变化一律不触发。
    const justReady =
      (prev.status === 'developing' &&
        (projectStatus === 'ready' || projectStatus === 'exported')) ||
      (prev.status === 'ready' && projectStatus === 'exported');

    prevRef.current = { status: projectStatus, projectId: currentProjectId };

    if (!justReady) return;

    // 用户已经在部署视图：不打扰；保留历史（不重 push），下次进入该状态自然消失
    if (currentView === 'deploy') return;

    const isExported = projectStatus === 'exported';
    try {
      pushNotification({
        kind: 'success',
        icon: '🎉',
        message: isExported
          ? '🎉 部署包已就绪，可以分发 / 上线了！'
          : '🎉 应用已就绪，可以部署了！',
        action: {
          label: '去看部署',
          onClick: () => setView('deploy'),
        },
        autoDismissMs: 8_000,
      });
    } catch (err) {
      console.warn('[useDeploymentReadyToast] pushNotification 失败', err);
    }
  }, [projectStatus, currentProjectId, currentView, pushNotification, setView]);
}
