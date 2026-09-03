/** @jest-environment node */
/**
 * v0.1.02 P1-2：项目同名自动加后缀时 meta.name 必须与目录名同步（UT-PCN-001~004）。
 *
 * 验收报告 P1-2：UI 提示「项目名」时按 dir.basename 加后缀，但 meta.name 仍然是用户输入的原始名，
 * 导致欢迎页 / ProjectSwitcher 显示「我的应用」而文件系统实际是「我的应用-2」，形成 UI 承诺与
 * 实际行为脱节。
 *
 * 修复（src/main/storage/index.ts：dirToDisplayName）：createProject 用实际目录名反推唯一显示名，
 * 让 meta.name 与 dir.basename 严格同步。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStorageManager } from '../../src/main/storage';
import { plainEncryptor } from '../../src/main/security/encryption';

async function makeStorage(): Promise<{ storage: FileStorageManager; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-test-'));
  const storage = new FileStorageManager(dir, plainEncryptor);
  await storage.init();
  return { storage, dir };
}

describe('项目创建同名加后缀 → meta.name 同步（v0.1.02 P1-2）', () => {
  it('UT-PCN-001 第一次创建无冲突：meta.name = 原始 name（无后缀）', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const meta = await storage.createProject('我的应用');
      expect(meta.name).toBe('我的应用');
      expect(storage.getProjectDir(meta.id)).toBe(path.join(dir, 'Project', '我的应用'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-PCN-002 重名第二次：meta.name = "我的应用-2"，与目录 basename 完全一致', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const customDir = path.join(dir, 'custom');
      await fs.mkdir(customDir, { recursive: true });
      const first = await storage.createProject('我的应用', { location: customDir });
      const second = await storage.createProject('我的应用', { location: customDir });

      // 核心不变式：meta.name 与目录 basename 严格一致
      expect(second.name).toBe('我的应用-2');
      expect(path.basename(storage.getProjectDir(second.id))).toBe('我的应用-2');
      expect(second.name).toBe(path.basename(storage.getProjectDir(second.id)));

      // 第一个不受影响
      expect(first.name).toBe('我的应用');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-PCN-003 重名三次：依次得到 -2/-3/-5 后缀（跳跃式），meta.name 全部与目录同步', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const customDir = path.join(dir, 'custom');
      await fs.mkdir(customDir, { recursive: true });
      const first = await storage.createProject('测试', { location: customDir });
      // 预创建 "测试-3" 占位，制造 -2/-4 中间空隙，验证 resolveProjectDir 的累加器不会撞名复用
      await fs.mkdir(path.join(customDir, '测试-3'), { recursive: true });
      const second = await storage.createProject('测试', { location: customDir });
      const third = await storage.createProject('测试', { location: customDir });

      expect(first.name).toBe('测试');
      expect(second.name).toBe('测试-2');
      expect(third.name).toBe('测试-4'); // 跳过 -3（已被占用）

      // 三者的 meta.name 与目录 basename 严格一致
      for (const m of [first, second, third]) {
        expect(m.name).toBe(path.basename(storage.getProjectDir(m.id)));
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-PCN-004 项目索引持久化后 meta.name 一致性：重启 FileStorageManager 仍能列出正确 name', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-test-'));
    try {
      const storage1 = new FileStorageManager(dir, plainEncryptor);
      await storage1.init();
      const customDir = path.join(dir, 'data');
      await fs.mkdir(customDir, { recursive: true });
      await storage1.createProject('记账本', { location: customDir });
      const second = await storage1.createProject('记账本', { location: customDir });

      // 模拟重启：新建实例读取 project-index.json
      const storage2 = new FileStorageManager(dir, plainEncryptor);
      await storage2.init();
      const meta = await storage2.getProject(second.id);
      expect(meta?.name).toBe('记账本-2');
      // 索引里的 name 与实际目录 basename 一致
      expect(path.basename(storage2.getProjectDir(second.id))).toBe('记账本-2');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-PCN-005 含非法字符 + 冲突：sanitize 后重名场景下 dirToDisplayName 仍能同步', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const customDir = path.join(dir, 'custom');
      await fs.mkdir(customDir, { recursive: true });
      // 第一次：sanitize 把 ":" 去掉 → dir "我的项目"，无冲突 → meta.name = originalName
      // （dirToDisplayName 检测到 last === base 直接返回 originalName）
      const first = await storage.createProject('我的:项目', { location: customDir });
      expect(first.name).toBe('我的:项目');
      expect(path.basename(storage.getProjectDir(first.id))).toBe('我的项目');

      // 第二次：sanitize 后 dir basename "我的项目-2"，反推 → meta.name = "我的:项目-2"
      // （保留原始字符串 + 数字后缀，与目录严格同步）
      const second = await storage.createProject('我的:项目', { location: customDir });
      expect(second.name).toBe('我的:项目-2');
      expect(path.basename(storage.getProjectDir(second.id))).toBe('我的项目-2');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});