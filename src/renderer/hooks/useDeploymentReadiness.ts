import { useMemo } from 'react';
import { useChatStore } from '../store/chat';
import { useExportStore } from '../store/export';
import { useProjectStore } from '../store/project';
import type { ProjectStatus } from '../../shared/types/project';

/**
 * 部署就绪度聚合 hook（P2 建议 2）。
 *
 * 解决两个历史包袱：
 *   1) v0.1.02 P3-5 把 canDeploy / canQuickStart / canPackage 内联在 DeployView.tsx，
 *      单测必须 mount 整个视图才能覆盖，分支回归成本高。
 *   2) DeploymentAssistant.tsx 的 identify 态又独立拼了一段"有 zip / 没 zip"文案，
 *      与 DeployView 的判断逻辑漂移，容易一边修一边忘另一边。
 *
 * 设计原则：
 *   - 输出「能/不能」布尔位 + 给 UI banner 用的 blocker 列表 + 给 AI 助手用的
 *     recommendation，三层粒度按使用场景解耦。
 *   - 纯函数 computeDeploymentReadiness 与 hook 解耦，单测只覆盖纯函数。
 *   - 严格保留 v0.1.02 P3-5 锁定的语义边界：
 *       canEnterDeploy / canShowGuide / canShowAdvanced：developing / ready / exported
 *       canQuickStart / canPackage：必须 ready / exported
 *
 * 命名约定：
 *   - canEnterDeploy 对应原 canDeploy（保持外部消费点改动最小）；
 *     canShowGuide / canShowAdvanced 是为后续 P3 / P4 banner 重构预留的新字段，
 *     本次 PR 不在视图中引入，避免单 PR 越界。
 */

export type DeploymentBlocker =
  | { kind: 'project-missing'; message: string }
  | { kind: 'project-not-started'; message: string }
  | { kind: 'project-not-planned'; message: string }
  | { kind: 'project-still-developing'; message: string };

export type DeploymentRecommendation = {
  icon: string;
  text: string;
  /**
   * 下一步建议跳到哪（对应 DeployView 的 DeployStage）。
   * null 表示「让用户自己决定」或「需要先回对话页处理前置条件」。
   */
  nextStage: 'quick-start' | 'package' | 'guide' | 'advanced' | null;
};

export type DeploymentReadiness = {
  /** 能否进入部署视图（developing / ready / exported）；原 canDeploy */
  canEnterDeploy: boolean;
  /** 🎯 一键启动：必须 ready / exported */
  canQuickStart: boolean;
  /** 🛠️ 智能打包：必须 ready / exported */
  canPackage: boolean;
  /** 📚 部署指引：与 canEnterDeploy 同边界（developing 即可看） */
  canShowGuide: boolean;
  /** ⚙️ 高级导出：与 canEnterDeploy 同边界 */
  canShowAdvanced: boolean;
  /**
   * 按优先级排序的「为什么不行 + 怎么解锁」列表。
   * AI 助手 identify 态、developing 状态下的 amber banner 都从这里消费。
   * 空数组表示已无任何阻塞项。
   */
  blockers: DeploymentBlocker[];
  /** 给 AI 助手 identify 态直接消费的「建议下一步」 */
  recommendation: DeploymentRecommendation;
  /**
   * 当前是否已有导出包（zip）。原 useExportStore.zipPath 透传，
   * 让助手 / 视图只读 readiness 就够，不必再单独订阅 export store。
   */
  zipPath: string | null;
};

/**
 * 纯函数：把 { currentProjectId, projectStatus, zipPath } 聚合成一份就绪度。
 * 与 hook 解耦，便于单测覆盖各种状态组合。
 */
export function computeDeploymentReadiness(input: {
  currentProjectId: string | null;
  projectStatus: ProjectStatus | null;
  zipPath: string | null;
}): DeploymentReadiness {
  const { currentProjectId, projectStatus, zipPath } = input;

  // —— 三道闸：保留 v0.1.02 P3-5 语义 ——
  const canEnterDeploy =
    projectStatus === 'developing' || projectStatus === 'ready' || projectStatus === 'exported';
  const canQuickStart = projectStatus === 'ready' || projectStatus === 'exported';
  const canPackage = projectStatus === 'ready' || projectStatus === 'exported';
  const canShowGuide = canEnterDeploy;
  const canShowAdvanced = canEnterDeploy;

  // —— blocker：按"阻塞核心动作"严重度倒序推入，前端显示第一条即可 ——
  const blockers: DeploymentBlocker[] = [];
  if (!currentProjectId) {
    blockers.push({
      kind: 'project-missing',
      message: '还没有创建项目，请先到对话页创建并开始开发',
    });
  } else if (projectStatus === null || projectStatus === 'draft') {
    blockers.push({
      kind: 'project-not-started',
      message: '项目还在草稿状态，请先到对话页确认需求',
    });
  } else if (projectStatus === 'planned') {
    blockers.push({
      kind: 'project-not-planned',
      message: '需求已规划，正在等待 AI 生成版本计划，请稍候',
    });
  } else if (projectStatus === 'developing') {
    blockers.push({
      kind: 'project-still-developing',
      message: '应用还在开发中；自动测试通过后会解锁一键启动与智能打包',
    });
  }
  // 注：ready / exported + 无 zip 的情况不计入 blocker——
  // 进入部署视图与四大支柱可达性不受影响，只是没有可分发的包，
  // 由 recommendation 引导用户去 ⚙️ 高级导出。

  const recommendation = recommend({
    canQuickStart,
    canPackage,
    zipPath,
    blockers,
  });

  return {
    canEnterDeploy,
    canQuickStart,
    canPackage,
    canShowGuide,
    canShowAdvanced,
    blockers,
    recommendation,
    zipPath,
  };
}

/**
 * 内部：根据 readiness 状态拼一句"建议下一步"。
 * 优先级：项目缺失 > 开发早期 > 一键启动 > 智能打包 > 高级导出 > 让用户自选。
 */
function recommend(input: {
  canQuickStart: boolean;
  canPackage: boolean;
  zipPath: string | null;
  blockers: DeploymentBlocker[];
}): DeploymentRecommendation {
  const { canQuickStart, canPackage, zipPath, blockers } = input;

  if (blockers.some((b) => b.kind === 'project-missing')) {
    return {
      icon: '💬',
      text: '先到对话页创建一个项目，我才能帮你部署',
      nextStage: null,
    };
  }

  const earlyBlocker = blockers.find(
    (b) =>
      b.kind === 'project-not-started' ||
      b.kind === 'project-not-planned' ||
      b.kind === 'project-still-developing',
  );
  if (earlyBlocker) {
    return { icon: '🛠️', text: earlyBlocker.message, nextStage: null };
  }

  if (canQuickStart) {
    return {
      icon: '🎯',
      text: '应用已就绪，建议先用「🎯 一键启动」零门槛跑起来',
      nextStage: 'quick-start',
    };
  }
  if (canPackage) {
    return {
      icon: '🛠️',
      text: '建议先用「🛠️ 智能打包」生成可分发的安装包',
      nextStage: 'package',
    };
  }
  if (!zipPath) {
    return {
      icon: '⚙️',
      text: '建议走「⚙️ 高级导出」生成部署包，再让我帮你部署',
      nextStage: 'advanced',
    };
  }

  return { icon: '🚀', text: '已就绪，可选任意一种部署方式', nextStage: null };
}

/** 部署就绪度聚合 hook。组件内调用，自动订阅三个 store。 */
export function useDeploymentReadiness(): DeploymentReadiness {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projectStatus = useChatStore((s) => s.projectStatus);
  const zipPath = useExportStore((s) => s.zipPath);

  return useMemo(
    () => computeDeploymentReadiness({ currentProjectId, projectStatus, zipPath }),
    [currentProjectId, projectStatus, zipPath],
  );
}
