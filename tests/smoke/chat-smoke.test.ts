import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { FileStorageManager } from '../../src/main/storage';
import { plainEncryptor } from '../../src/main/security/encryption';
import { DSHService } from '../../src/main/dsh/service';
import { ChatFlow } from '../../src/main/chat/flow';

/**
 * 真实 DSH 对话流冒烟测试（不纳入 test:unit，需真实 dsh 命令 + DSH_HOME 凭证）。
 * 运行：npx jest tests/smoke/chat-smoke.test.ts --config jest.config.cjs
 */
describe('smoke: 真实 DSH 对话流', () => {
  it(
    '一轮需求对话：得到 AI 回复，需求收敛时保存需求卡片',
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
        const flow = new ChatFlow({ storage, dsh });

        const outcome = await flow.handleSend(
          meta.id,
          '我想做一个记账工具，个人使用，主要功能是记录收支、按分类统计，界面要简洁清爽',
        );

        console.log('[smoke] AI 回复:', outcome.reply.slice(0, 300));
        expect(outcome.reply.length).toBeGreaterThan(0);

        const req = await storage.getRequirements(meta.id);
        console.log('[smoke] 需求卡片:', JSON.stringify(req, null, 2));
        if (req && (req.goal || req.coreFeatures.length > 0)) {
          console.log('[smoke] ✅ 需求已收敛并保存');
        } else {
          console.log('[smoke] ⚠️ 需求未收敛（继续对话即可）');
        }
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
    300_000,
  );
});
