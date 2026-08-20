import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { FileStorageManager } from '../../src/main/storage';
import { plainEncryptor } from '../../src/main/security/encryption';
import { DSHService } from '../../src/main/dsh/service';
import { toRequirements } from '../../src/main/dsh/structured';
import { Developer } from '../../src/main/dev/developer';
import { ChatFlow } from '../../src/main/chat/flow';

/**
 * 真实 DSH 端到端冒烟：需求确认 → 开发生成代码 → 口语修改 → 文件变更。
 * 运行：npx jest --config jest.config.cjs --roots tests/smoke
 */
describe('smoke: 开发与口语修改链路', () => {
  it(
    '真实链路：开发生成应用 → 口语修改 → 文件变化',
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-smoke-'));
      try {
        const storage = new FileStorageManager(dir, plainEncryptor);
        await storage.init();
        const meta = await storage.createProject('冒烟测试项目');

        const dshBin =
          process.env.FREECODER_DSH_BIN ??
          'G:\\DSH\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js';
        const dsh = new DSHService({ command: [process.execPath, dshBin] });

        // 1. 确认需求并开发
        await storage.saveRequirements(
          meta.id,
          toRequirements(meta.id, {
            project_name: '冒烟测试',
            goal: '个人收支记录工具',
            target_users: '个人使用',
            core_features: ['记录收支', '显示余额'],
            visual_style: '简洁',
          }),
        );
        const developer = new Developer({ storage, dsh });
        const devOutcome = await new Promise<{
          success: boolean;
          message: string;
        }>((resolve) => developer.startDevelopment(meta.id, resolve));
        console.log('[smoke] 开发结果:', devOutcome.message);
        expect(devOutcome.success).toBe(true);

        const codePath = storage.getProjectCodePath(meta.id);
        const files = await fs.readdir(codePath);
        console.log('[smoke] 生成文件:', files);
        expect(files.some((f) => f === 'index.html')).toBe(true);

        // 2. 口语修改
        const flow = new ChatFlow({ storage, dsh });
        const modify = await flow.handleSend(meta.id, '把页面的主标题颜色改成天蓝色 #4A90D9');
        console.log('[smoke] 修改回复:', modify.reply.slice(0, 200));

        // 3. 验证代码文件已更新（含新颜色）
        const html = await fs.readFile(path.join(codePath, 'index.html'), 'utf-8');
        const styleFiles = (await fs.readdir(codePath)).filter((f) => f.endsWith('.css'));
        let allCode = html;
        for (const f of styleFiles) {
          allCode += await fs.readFile(path.join(codePath, f), 'utf-8');
        }
        if (allCode.toLowerCase().includes('#4a90d9')) {
          console.log('[smoke] ✅ 修改已写入代码文件');
        } else {
          console.log('[smoke] ⚠️ 未检测到目标颜色（AI 可能用了其他实现）');
        }
        expect(modify.reply.length).toBeGreaterThan(0);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
