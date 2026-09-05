/**
 * P2 建议 2 单测：computeDeploymentReadiness 纯函数行为。
 *
 * 锁定的语义（v0.1.02 P3-5 + P2 建议 2）：
 *   - canEnterDeploy: developing / ready / exported → true
 *   - canQuickStart / canPackage: 仅 ready / exported → true
 *   - blockers: 按「项目缺失 > 草稿 > 规划 > 开发中」倒序，最多一条
 *   - recommendation: 项目缺失/早期 → 引导回对话页；ready/exported → 优先 quick-start
 *   - zipPath: 透传原始信号（让助手一次 hook 取齐）
 *
 * hook 自身的订阅行为由 deploy-assistant.test.tsx 间接覆盖（识别态消费 readiness）。
 */
import { computeDeploymentReadiness } from '../../src/renderer/hooks/useDeploymentReadiness';

describe('computeDeploymentReadiness（P2 建议 2）', () => {
  describe('三道闸布尔位（v0.1.02 P3-5 语义保持）', () => {
    it('P2-RDY-001 draft 状态：canEnterDeploy=false，所有执行闸均 false', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'draft',
        zipPath: null,
      });
      expect(r.canEnterDeploy).toBe(false);
      expect(r.canQuickStart).toBe(false);
      expect(r.canPackage).toBe(false);
      expect(r.canShowGuide).toBe(false);
      expect(r.canShowAdvanced).toBe(false);
    });

    it('P2-RDY-002 planned 状态：与 draft 一样被部署视图拦截', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'planned',
        zipPath: null,
      });
      expect(r.canEnterDeploy).toBe(false);
      expect(r.canQuickStart).toBe(false);
      expect(r.canPackage).toBe(false);
    });

    it('P2-RDY-003 developing 状态：可进视图，但 🎯 / 🛠️ 仍灰', () => {
      // 这是 v0.1.02 P3-5 锁定的关键边界：能进部署页但还不能打包/启动
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'developing',
        zipPath: null,
      });
      expect(r.canEnterDeploy).toBe(true);
      expect(r.canShowGuide).toBe(true);
      expect(r.canShowAdvanced).toBe(true);
      expect(r.canQuickStart).toBe(false);
      expect(r.canPackage).toBe(false);
    });

    it('P2-RDY-004 ready 状态：所有闸打开', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'ready',
        zipPath: null,
      });
      expect(r.canEnterDeploy).toBe(true);
      expect(r.canQuickStart).toBe(true);
      expect(r.canPackage).toBe(true);
      expect(r.canShowGuide).toBe(true);
      expect(r.canShowAdvanced).toBe(true);
    });

    it('P2-RDY-005 exported 状态：与 ready 行为一致', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'exported',
        zipPath: '/tmp/deploy.zip',
      });
      expect(r.canEnterDeploy).toBe(true);
      expect(r.canQuickStart).toBe(true);
      expect(r.canPackage).toBe(true);
    });
  });

  describe('blockers 列表', () => {
    it('P2-RDY-010 没有项目 → blockers = [project-missing]', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: null,
        projectStatus: null,
        zipPath: null,
      });
      expect(r.blockers).toHaveLength(1);
      expect(r.blockers[0]?.kind).toBe('project-missing');
    });

    it('P2-RDY-011 null / draft 状态 → blockers = [project-not-started]', () => {
      const r1 = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: null,
        zipPath: null,
      });
      expect(r1.blockers[0]?.kind).toBe('project-not-started');

      const r2 = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'draft',
        zipPath: null,
      });
      expect(r2.blockers[0]?.kind).toBe('project-not-started');
    });

    it('P2-RDY-012 planned 状态 → blockers = [project-not-planned]', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'planned',
        zipPath: null,
      });
      expect(r.blockers[0]?.kind).toBe('project-not-planned');
    });

    it('P2-RDY-013 developing 状态 → blockers = [project-still-developing]', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'developing',
        zipPath: null,
      });
      expect(r.blockers[0]?.kind).toBe('project-still-developing');
      // 解锁路径必须在文案里说出来，方便 AI 助手 / banner 直接展示
      expect(r.blockers[0]?.message).toContain('自动测试');
    });

    it('P2-RDY-014 ready + 无 zip 不计入 blocker（部署视图与四大支柱仍可用）', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'ready',
        zipPath: null,
      });
      // 没有 blocker 阻塞核心动作；缺 zip 走 recommendation 引导
      expect(r.blockers).toHaveLength(0);
      expect(r.canEnterDeploy).toBe(true);
      expect(r.canQuickStart).toBe(true);
    });
  });

  describe('recommendation（给 AI 助手 identify 态用）', () => {
    it('P2-RDY-020 项目缺失 → 引导回对话页（nextStage=null）', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: null,
        projectStatus: null,
        zipPath: null,
      });
      expect(r.recommendation.nextStage).toBeNull();
      expect(r.recommendation.icon).toBe('💬');
    });

    it('P2-RDY-021 developing → 引导文案等于对应 blocker 的 message', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'developing',
        zipPath: null,
      });
      expect(r.recommendation.text).toBe(r.blockers[0]?.message);
      expect(r.recommendation.nextStage).toBeNull();
    });

    it('P2-RDY-022 ready → 优先推荐 quick-start（最低门槛）', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'ready',
        zipPath: null,
      });
      expect(r.recommendation.nextStage).toBe('quick-start');
      expect(r.recommendation.icon).toBe('🎯');
    });

    it('P2-RDY-023 exported + 有 zip → 仍优先 quick-start（最低门槛），不重复推 advanced', () => {
      // 行为契约：quick-start 在 ready/exported 下永远优先级最高，
      // 哪怕已经有 zip 也先让用户零门槛跑起来，zip 留给后续 packaging 阶段。
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'exported',
        zipPath: '/tmp/x.zip',
      });
      expect(r.recommendation.nextStage).toBe('quick-start');
    });

    it('P2-RDY-024 ready + 有 zip：recommendation 仍是 quick-start（不跳到 package）', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'ready',
        zipPath: '/tmp/x.zip',
      });
      expect(r.recommendation.nextStage).toBe('quick-start');
    });
  });

  describe('zipPath 透传', () => {
    it('P2-RDY-030 hook 返回值透传 zipPath（null）', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'ready',
        zipPath: null,
      });
      expect(r.zipPath).toBeNull();
    });

    it('P2-RDY-031 hook 返回值透传 zipPath（非 null）', () => {
      const r = computeDeploymentReadiness({
        currentProjectId: 'p1',
        projectStatus: 'exported',
        zipPath: '/Users/me/freecoder-deploy.zip',
      });
      expect(r.zipPath).toBe('/Users/me/freecoder-deploy.zip');
    });
  });
});
