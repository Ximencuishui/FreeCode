import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStorageManager, atomicWrite } from '../../src/main/storage';
import { plainEncryptor } from '../../src/main/security/encryption';
import type { ProjectMeta } from '../../src/main/storage/types';

/**
 * 存储模块单元测试（测试计划 4.2.3 UT-STO-001~005）。
 * 使用临时目录隔离，不影响用户数据（测试计划 3.3）。
 */

async function makeStorage(): Promise<{ storage: FileStorageManager; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-test-'));
  const storage = new FileStorageManager(dir, plainEncryptor);
  await storage.init();
  return { storage, dir };
}

describe('存储模块（UT-STO）', () => {
  it('UT-STO-001 创建项目：默认保存到 Project 目录，目录结构正确，meta.json 生成', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const meta = await storage.createProject('我的记账本', {
        template: 'tool',
        description: '个人收支记录',
      });

      expect(meta.id).toMatch(/^\d{8}T\d{6}-[0-9a-f]{12}$/);
      expect(meta.status).toBe('draft');
      expect(meta.totalChatMessages).toBe(0);

      // 默认位置：数据目录下的 Project/{项目名}
      const projDir = path.join(dir, 'Project', '我的记账本');
      expect(storage.getProjectDir(meta.id)).toBe(projDir);
      expect(storage.getProjectCodePath(meta.id)).toBe(path.join(projDir, 'code'));
      // 目录结构：meta / requirements / chat-history / code / exports
      await expect(fs.access(path.join(projDir, 'meta.json'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(projDir, 'requirements.json'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(projDir, 'chat-history.json'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(projDir, 'code'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(projDir, 'exports'))).resolves.toBeUndefined();

      // 初始需求：未确认、空内容
      const req = await storage.getRequirements(meta.id);
      expect(req?.confirmed).toBe(false);
      expect(req?.goal).toBe('');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-STO-006 自定义保存位置：项目创建在用户选择的目录下', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const customDir = path.join(dir, '我的资料', '项目');
      await fs.mkdir(customDir, { recursive: true });
      const meta = await storage.createProject('记账本', { location: customDir });

      const projDir = path.join(customDir, '记账本');
      expect(storage.getProjectDir(meta.id)).toBe(projDir);
      await expect(fs.access(path.join(projDir, 'meta.json'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(projDir, 'code'))).resolves.toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-STO-007 重名项目：同位置自动追加 -2/-3 后缀，互不覆盖', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const customDir = path.join(dir, 'custom');
      await fs.mkdir(customDir, { recursive: true });

      const first = await storage.createProject('我的应用', { location: customDir });
      const second = await storage.createProject('我的应用', { location: customDir });
      const third = await storage.createProject('我的应用', { location: customDir });

      expect(storage.getProjectDir(first.id)).toBe(path.join(customDir, '我的应用'));
      expect(storage.getProjectDir(second.id)).toBe(path.join(customDir, '我的应用-2'));
      expect(storage.getProjectDir(third.id)).toBe(path.join(customDir, '我的应用-3'));

      // 三个项目都能独立读取
      const metas = await storage.listProjects();
      expect(metas.map((m) => m.id).sort()).toEqual([first.id, second.id, third.id].sort());
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-STO-008 非法字符清洗：文件夹名去除文件系统非法字符', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const meta = await storage.createProject('我的:项目/应用?*');
      expect(storage.getProjectDir(meta.id)).toBe(path.join(dir, 'Project', '我的项目应用'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-STO-009 索引持久化：重启后仍能找到自定义位置的项目', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-test-'));
    try {
      const storage = new FileStorageManager(dir, plainEncryptor);
      await storage.init();
      const customDir = path.join(dir, 'data');
      await fs.mkdir(customDir, { recursive: true });
      const meta = await storage.createProject('持久化项目', { location: customDir });

      // 模拟重启：新建实例、重新 init
      const storage2 = new FileStorageManager(dir, plainEncryptor);
      await storage2.init();
      const metas = await storage2.listProjects();
      expect(metas.map((m) => m.id)).toContain(meta.id);
      expect(storage2.getProjectDir(meta.id)).toBe(path.join(customDir, '持久化项目'));
      await expect(
        fs.access(path.join(customDir, '持久化项目', 'meta.json')),
      ).resolves.toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-STO-010 旧布局回填：projects/{id} 下的存量项目仍可列出', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-test-'));
    try {
      // 预置旧布局项目（模拟升级前创建的数据）
      const oldId = '20260819T120000-abcdefabcdef';
      const oldDir = path.join(dir, 'projects', oldId);
      await fs.mkdir(oldDir, { recursive: true });
      const meta: ProjectMeta = {
        id: oldId,
        name: '旧项目',
        status: 'draft',
        createdAt: '2026-08-19T12:00:00.000Z',
        updatedAt: '2026-08-19T12:00:00.000Z',
        lastOpenedAt: '2026-08-19T12:00:00.000Z',
        codePath: './code',
        exportCount: 0,
        totalChatMessages: 0,
      };
      await atomicWrite(path.join(oldDir, 'meta.json'), meta);

      const storage = new FileStorageManager(dir, plainEncryptor);
      await storage.init();

      const metas = await storage.listProjects();
      expect(metas.map((m) => m.id)).toContain(oldId);
      expect(storage.getProjectDir(oldId)).toBe(oldDir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-STO-002 保存对话消息：消息追加，不覆盖已有数据', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const meta = await storage.createProject('测试项目');
      await storage.saveChatMessage(meta.id, {
        role: 'user',
        content: '第一条',
        isComplete: true,
      });
      await storage.saveChatMessage(meta.id, {
        role: 'assistant',
        content: '第二条',
        isComplete: true,
      });

      const history = await storage.getChatHistory(meta.id);
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('第一条');
      expect(history[1].content).toBe('第二条');
      expect(history[1].id).toMatch(/^msg-/);

      const metaAfter = await storage.getProject(meta.id);
      expect(metaAfter?.totalChatMessages).toBe(2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-STO-003 原子写入：残留临时文件被清理，数据完整', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-test-'));
    try {
      const file = path.join(dir, 'data.json');
      await atomicWrite(file, { value: '旧数据' });

      // 预置一个残留 tmp 文件（模拟上次写入中断）
      await fs.writeFile(`${file}.tmp`, '{"broken":true}', 'utf-8');

      await atomicWrite(file, { value: '新数据' });
      const content = JSON.parse(await fs.readFile(file, 'utf-8'));
      expect(content.value).toBe('新数据');

      // tmp 与 bak 均被清理，不留残留
      await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
      await expect(fs.access(`${file}.bak`)).rejects.toThrow();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-STO-004 读取不存在的项目：返回 null / 空，不抛异常', async () => {
    const { storage, dir } = await makeStorage();
    try {
      await expect(storage.getProject('not-exist')).resolves.toBeNull();
      await expect(storage.getRequirements('not-exist')).resolves.toBeNull();
      await expect(storage.getChatHistory('not-exist')).resolves.toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-STO-005 对话历史归档：超过上限自动归档', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-test-'));
    try {
      // 用小上限（5 条）快速验证归档逻辑；生产默认 1000 条
      const storage = new FileStorageManager(dir, plainEncryptor, 5);
      await storage.init();
      const meta = await storage.createProject('大项目');
      for (let i = 0; i < 6; i++) {
        await storage.saveChatMessage(meta.id, {
          role: 'user',
          content: `消息${i}`,
          isComplete: true,
        });
      }

      const history = await storage.getChatHistory(meta.id, 50);
      expect(history).toHaveLength(5);
      expect(history[4].content).toBe('消息5');

      // 旧消息进入归档文件，主文件保留最近 5 条
      const projDir = path.join(dir, 'Project', '大项目');
      const archive = JSON.parse(
        await fs.readFile(path.join(projDir, 'chat-history.archive.json'), 'utf-8'),
      );
      expect(archive.messages).toHaveLength(1);
      expect(archive.messages[0].content).toBe('消息0');

      const mainFile = JSON.parse(
        await fs.readFile(path.join(projDir, 'chat-history.json'), 'utf-8'),
      );
      expect(mainFile.messages).toHaveLength(5);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('UT-REQ-004 需求确认：confirmed=true 且记录确认时间', async () => {
    const { storage, dir } = await makeStorage();
    try {
      const meta = await storage.createProject('记账本');
      const req = await storage.getRequirements(meta.id);
      expect(req?.confirmed).toBe(false);

      await storage.confirmRequirements(meta.id);
      const confirmed = await storage.getRequirements(meta.id);
      expect(confirmed?.confirmed).toBe(true);
      expect(confirmed?.confirmedAt).toBeTruthy();
      // 变更历史追加
      expect(confirmed?.history.length).toBeGreaterThanOrEqual(2);
      expect(confirmed?.history[confirmed.history.length - 1].changes).toContain('确认');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
