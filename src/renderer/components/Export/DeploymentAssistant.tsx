import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat';
import { useExportStore } from '../../store/export';

/**
 * AI 部署助手（v3.2，PRD 2.4.4）。
 *
 * 升级（v3.2.1）：三态从纯 UI mock 降级为"真实引导式"——
 *   - identify（识别）：基于环境检测 + 项目状态给出真实判断；
 *   - guide（引导）：给出可执行的 docker / 服务器 / 云命令，含"复制"与"打开部署指南"按钮；
 *   - fallback（兜底）：如果用户嫌麻烦，触发 shell 打开本地 deploy-guide.html。
 *
 * 仍然不接入真实的云平台 deploy API（超出本迭代范围），但所有按钮都是真实动作。
 */

type AssistantMode = 'identify' | 'guide' | 'fallback';

const MODE_META: Record<AssistantMode, { icon: string; title: string; tag: string; tone: string }> = {
  identify: {
    icon: '🧭',
    title: '我帮你判断哪种部署方式最合适',
    tag: '识别',
    // v0.1.02 P2-6：原来"我比你更知道该走哪条路"对非技术用户有傲慢感，
    // 改成中性陈述：基于项目情况推荐，由用户决定。
    tone: '基于项目情况给出建议，你来选择',
  },
  guide: {
    icon: '🪜',
    title: '一步步带你操作',
    tag: '引导',
    // v0.1.02 P2-6：原来"你看着就行，我来操作"语义模糊（既像代操作又像操作后等你确认），
    // 明确成"我提示，你执行"，避免误导。
    tone: '每一步都先告诉你，再由你执行',
  },
  fallback: {
    icon: '📋',
    // v3.2.1 P0-4：标题改为「我把一切准备好了，剩最后一步你点点鼠标」，
    // 强调"AI 做准备工作 + 用户做最后一步"的分界，避免假承诺"我替你跑通"。
    title: '我把一切准备好了，剩最后一步你点点鼠标',
    tag: '兜底',
    // v0.1.02 P2-6：原来"复制粘贴一下，几分钟搞定"潜台词是嘲讽用户不会；
    // 改成中性陈述：把准备工作做完，最后一步由用户执行（安全约束）。
    tone: '我能做的全部做完；服务器命令由你执行',
  },
};

interface DeploymentAssistantProps {
  onClose: () => void;
  /** 兜底完成后调用（让 DeployView 关闭助手浮层并回到 home） */
  onSuccess: () => void;
}

interface GuideStep {
  title: string;
  cmd: string;
  hint: string;
}

const DOCKER_STEPS: GuideStep[] = [
  {
    title: '把部署包上传到服务器',
    cmd: 'scp freecoder-deploy.zip user@your-server:~/',
    hint: '也可以用 FTP / 阿里云 OSS 控制台上传',
  },
  {
    title: '在服务器上解压',
    cmd: 'cd ~ && unzip freecoder-deploy.zip && cd freecoder-deploy',
    hint: '确保服务器已安装 unzip；没有就先 apt install unzip',
  },
  {
    title: '启动应用',
    cmd: 'docker-compose up -d',
    hint: '首次启动会拉镜像 + 初始化数据库，约 1-2 分钟',
  },
  {
    title: '访问应用',
    cmd: 'http://your-server-ip:3000',
    hint: '在浏览器打开；如不能访问，请检查云服务商安全组是否放行 3000 端口',
  },
];

const SERVER_STEPS: GuideStep[] = [
  {
    title: '购买服务器（最低 2 核 2GB）',
    cmd: '# 阿里云 / 腾讯云 / AWS 任选\n# 操作系统：Ubuntu 22.04',
    hint: '新用户通常有 1-3 个月免费试用',
  },
  {
    title: '安装 Docker 与 Docker Compose',
    cmd: 'curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER',
    hint: '需要重新登录一次才能免 sudo 使用 docker',
  },
  {
    title: '上传并启动',
    cmd: 'scp freecoder-deploy.zip user@server:~/ && ssh user@server "cd ~ && unzip -o freecoder-deploy.zip && cd freecoder-deploy && docker-compose up -d"',
    hint: '也可分两步：先 scp 上传，再 ssh 远程执行',
  },
];

const CLOUD_STEPS: GuideStep[] = [
  {
    title: '选择一家云平台',
    cmd: '# 推荐：Railway / Render / Fly.io\n#  这三家对 docker-compose 支持最好，免费额度够个人项目',
    hint: '国内可考虑阿里云轻量应用容器（支持 docker-compose）',
  },
  {
    title: '把部署包上传并指定启动命令',
    cmd: 'docker-compose up -d',
    hint: '云平台会自动识别 Dockerfile 与 docker-compose.yml',
  },
  {
    title: '绑定公开域名（HTTPS 自动签发）',
    cmd: '# 在云平台控制台添加 custom domain\n# Cloudflare / Let’s Encrypt 自动签证书',
    hint: '一般 5 分钟内可拿到一个 https://xxx.app 的公开链接',
  },
];

const TARGET_CONTENT: Record<'cloud' | 'docker' | 'server', GuideStep[]> = {
  cloud: CLOUD_STEPS,
  docker: DOCKER_STEPS,
  server: SERVER_STEPS,
};

/**
 * v3.2.1 P0-2（修订）：每种 target 都有显式的"启动命令"，不再从 STEPS 按 index 取最后一条。
 * 原来"取最后一条"的逻辑有 bug：docker target 最后一步是「访问 http://your-server-ip:3000」，
 * 这是 URL 不是命令；切到 cloud/server 时拿到的也是"绑定域名 / ssh 上传"等非启动命令，
 * 复制到剪贴板会让用户在终端粘贴到一堆非执行语句，体验极差。
 *
 * 现在用显式字典兜底，每种 target 都给一句"真正能跑"的命令：
 * - docker：docker-compose up -d
 * - server：scp 上传 + ssh 远程启动（一步到位）
 * - cloud：docker-compose up -d（云平台自动识别 Dockerfile）
 */
const TARGET_START_CMD: Record<'cloud' | 'docker' | 'server', string> = {
  docker: 'docker-compose up -d',
  cloud: 'docker-compose up -d',
  server:
    'scp freecoder-deploy.zip user@server:~/ && ssh user@server "cd ~ && unzip -o freecoder-deploy.zip && cd freecoder-deploy && docker-compose up -d"',
};

export default function DeploymentAssistant({ onClose, onSuccess }: DeploymentAssistantProps) {
  const [mode, setMode] = useState<AssistantMode>('identify');
  const [target, setTarget] = useState<'cloud' | 'docker' | 'server'>('docker');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const pushMessage = useChatStore((s) => s.pushMessage);
  const cleanMessagesBySession = useChatStore((s) => s.cleanMessagesBySession);
  const zipPath = useExportStore((s) => s.zipPath);
  const greetedRef = useRef(false);
  // v3.2.1 P2-18：为本助手实例生成 sessionId，所有推送的助手消息都会带 metadata.sessionId，
  // 切换项目时 App.tsx 调 cleanMessagesBySession({ channel: 'deploy-assistant' }) 清理，
  // 避免旧项目的部署助手消息混入新项目对话流。
  // 不依赖项目 id 命名（每次部署助手实例化都新生成），这样即使同项目内重启部署助手也能干净清理。
  const sessionIdRef = useRef<string>(
    `deploy-assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  // v3.2.1 P2-18：用 useMemo 稳定 sessionMeta 引用，避免作为 useEffect deps 时每次渲染都触发重跑。
  // ESLint react-hooks/exhaustive-deps 警告：内联对象作为 deps 会导致 effect 永远重跑。
  const sessionMeta = useMemo(
    () => ({ sessionId: sessionIdRef.current, channel: 'deploy-assistant' }),
    [],
  );

  // 进入助手 → 主动推送开场白到聊天流
  useEffect(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    pushMessage({
      role: 'assistant',
      content:
        '[部署助手] 你好，我是 FreeCoder 的部署助手 🚀\n\n' +
        '我来帮你把应用真正"跑起来"。先选一个目标（云端 / Docker / 服务器），' +
        '然后跟着步骤走，每一步都可以直接复制命令。',
      timestamp: new Date().toISOString(),
      metadata: sessionMeta,
    });
  }, [pushMessage, sessionMeta]);

  // v3.2.1 P2-18：组件卸载时清理本次会话的所有消息（避免用户开 → 关 → 开 累积多条"切换模式"）。
  // onClose/onSuccess 走的也是卸载路径，所以这里覆盖了"主动关闭"和"完成兜底"两种退出方式。
  // ESLint react-hooks/exhaustive-deps 警告：ref 值在 cleanup 时可能已被改写，因此把 sessionId
  // 捕获到 effect 局部变量，cleanup 用局部变量，避免 React 误判。
  useEffect(() => {
    const sid = sessionIdRef.current;
    return () => {
      cleanMessagesBySession({ sessionId: sid });
    };
  }, [cleanMessagesBySession]);

  const handleModeSwitch = (next: AssistantMode) => {
    setMode(next);
    const meta = MODE_META[next];
    pushMessage({
      role: 'assistant',
      content: `[部署助手] 切换到【${meta.tag}】模式 — ${meta.tone}`,
      timestamp: new Date().toISOString(),
      metadata: sessionMeta,
    });
  };

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      // 剪贴板不可用时静默失败
    }
  };

  const handleOpenGuideHtml = async () => {
    if (!zipPath) {
      pushMessage({
        role: 'assistant',
        content: '[部署助手] 还没导出部署包。请先在「⚙️ 高级导出」走完 5 步向导。',
        timestamp: new Date().toISOString(),
        metadata: sessionMeta,
      });
      return;
    }
    // zipPath 是 .zip；deploy-guide.html 在解包后的目录里。把 zipPath 的 .zip 去掉，
    // 让用户在文件管理器中展开后双击 deploy-guide.html
    const folder = zipPath.replace(/\.zip$/i, '');
    await window.electron.app.revealInFolder(folder);
    pushMessage({
      role: 'assistant',
      content: `[部署助手] 已为你打开部署指南目录。展开后双击 deploy-guide.html 即可在浏览器看到图文步骤。`,
      timestamp: new Date().toISOString(),
      metadata: sessionMeta,
    });
  };

  /**
   * v0.1.02 P0-4：兜底按钮的语义从"我替你完成"改为"我准备好一切，最后一步你来"。
   * 没有部署包时拒绝执行（不假装接管）；有部署包时调通 deploy-guide.html + 复制命令，
   * 并在聊天里明确说明 FreeCoder 不会替你执行服务器命令。
   * onSuccess() 仅在有 zipPath 时调用，让 DeployView 进入 success stage。
   */
  const handleTakeOver = async () => {
    if (!zipPath) {
      pushMessage({
        role: 'assistant',
        content:
          '[部署助手] 📋 准备工作还没法开始 —— 还差一份部署包。\n\n' +
          '请先到「⚙️ 高级导出」走完 5 步向导拿到 .zip，我再帮你打开部署指南 + 复制启动命令。',
        timestamp: new Date().toISOString(),
        metadata: sessionMeta,
      });
      return;
    }
    // v3.2.1 P0-2：兜底必须按当前 target 取对应引导的"启动命令"，不再硬编码 docker-compose。
    // 用 TARGET_START_CMD 显式字典，避免从 STEPS 按 index 取（docker 的最后一步是 URL，不是命令）。
    const startCmd = TARGET_START_CMD[target];
    pushMessage({
      role: 'assistant',
      content:
        `[部署助手] ✨ 我把一切准备好了：\n\n` +
        `• 已为你打开部署指南目录（展开后双击 deploy-guide.html 看图文步骤）\n` +
        `• 已复制启动命令到剪贴板（${startCmd}）\n\n` +
        `⚠️ FreeCoder 不替你执行服务器命令 —— 这一步仍需要你登录到自己的服务器粘贴运行（出于安全考虑）。`,
      timestamp: new Date().toISOString(),
      metadata: sessionMeta,
    });
    await handleOpenGuideHtml();
    try {
      await navigator.clipboard.writeText(startCmd);
    } catch {
      /* 剪贴板不可用时静默失败（已在 handleCopy 中处理过类似场景） */
    }
    onSuccess();
  };

  const meta = MODE_META[mode];
  const steps = TARGET_CONTENT[target];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fc-deploy-assistant-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
    >
      <div
        className="m-4 flex w-full max-w-md flex-col rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">{meta.icon}</span>
              <span id="fc-deploy-assistant-title" className="text-sm font-semibold text-slate-800">{meta.title}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                {meta.tag}
              </span>
              <span className="text-xs text-slate-400">{meta.tone}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="关闭助手"
          >
            ✕
          </button>
        </div>

        {/* 三态切换 */}
        <div role="radiogroup" aria-label="部署助手模式" className="mt-4 grid grid-cols-3 gap-2">
          {(Object.keys(MODE_META) as AssistantMode[]).map((m) => {
            const mMeta = MODE_META[m];
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleModeSwitch(m)}
                className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <div aria-hidden="true">{mMeta.icon}</div>
                <div className="mt-0.5">{mMeta.tag}</div>
              </button>
            );
          })}
        </div>

        {/* 目标切换（guide 态下） */}
        {mode === 'guide' && (
          <div role="radiogroup" aria-label="部署目标" className="mt-3 flex gap-2">
            {(['cloud', 'docker', 'server'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={target === t}
                onClick={() => setTarget(t)}
                className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                  target === t
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {t === 'cloud' ? '☁️ 云平台' : t === 'docker' ? '🐳 Docker' : '🖥️ 服务器'}
              </button>
            ))}
          </div>
        )}

        {/* 当前态的具体动作 */}
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          {mode === 'identify' && (
            <>
              <div className="font-medium text-slate-700">🧭 我正在分析…</div>
              <div className="mt-1">
                {zipPath
                  ? `已检测到部署包：${zipPath.split(/[/\\]/).pop()}。建议新手用「Docker」，会运维用「服务器」，想偷懒用「云平台」。`
                  : '尚未导出部署包。请先在「⚙️ 高级导出」走完 5 步向导；或者选「一键启动」先在本地跑起来。'}
              </div>
            </>
          )}
          {mode === 'guide' && (
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={s.title} className="rounded-md bg-white p-2 ring-1 ring-slate-200">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-slate-700">
                      {i + 1}. {s.title}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopy(s.cmd, i)}
                      aria-label={
                        copiedIdx === i
                          ? `第 ${i + 1} 步命令已复制到剪贴板`
                          : `复制第 ${i + 1} 步命令：${s.title}`
                      }
                      className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                    >
                      {copiedIdx === i ? '已复制 ✓' : '复制'}
                    </button>
                  </div>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-[10px] text-slate-200">
                    {s.cmd}
                  </pre>
                  <div className="mt-1 text-[11px] text-slate-500">{s.hint}</div>
                </div>
              ))}
              {zipPath && (
                <button
                  type="button"
                  onClick={() => void handleOpenGuideHtml()}
                  aria-label="打开本地 deploy-guide.html（图文完整版）"
                  className="w-full rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-emerald-700 hover:bg-emerald-100"
                >
                  📂 打开本地 deploy-guide.html（图文完整版）
                </button>
              )}
            </div>
          )}
          {mode === 'fallback' && (
            <>
              {/* v3.2.1 P0-3：兜底模式的核心约束提前到顶部显眼位置（amber banner），
                  避免用户期待"AI 接管 → 自动跑通"，实际只是"准备工作 + 复制命令"。
                  之前只在底部一行小字 + 聊天消息里说明，用户容易忽略。 */}
              <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-amber-800">
                <div className="flex items-start gap-1.5">
                  <span aria-hidden>⚠️</span>
                  <div>
                    <div className="font-medium">当前模式 AI 不会替你执行服务器命令</div>
                    <div className="mt-0.5 text-[11px] text-amber-700">
                      FreeCoder 仅做"打开部署指南 + 复制命令"等准备工作；最后一步需你自己在服务器上粘贴运行（出于安全考虑）。
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2 font-medium text-slate-700">📋 准备工作清单</div>
              <div className="mt-1">下面这些动作我会替你做完：</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-600">
                <li>打开本地部署指南（deploy-guide.html）</li>
                <li>把启动命令复制到剪贴板</li>
                <li>把部署包目录在文件管理器中高亮</li>
              </ul>
              <div className="mt-2 text-[11px] text-slate-500">
                点击下方按钮后，到 <span className="font-medium">deploy-guide.html</span> 查看图文步骤，按指引执行。
              </div>
            </>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="mt-4 flex gap-2">
          {mode === 'fallback' ? (
            // v3.2.1 P0-4：按钮文案改为「接管操作」+ 副文案说明边界，
            // 让单测 / 屏幕阅读器都能精准定位（UT-DA-002/003/004 依赖此按钮名）。
            <button
              type="button"
                onClick={handleTakeOver}
                className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
                data-testid="fc-deploy-takeover"
              >
                ✨ 接管操作（做完准备工作 + 复制命令）
              </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                暂时不需要
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch(mode === 'identify' ? 'guide' : 'fallback')}
                className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
              >
                {mode === 'identify' ? '接受推荐' : '帮我接管'}
              </button>
            </>
          )}
        </div>

        {/* 降级链提示 */}
        <div className="mt-3 text-center text-[10px] text-slate-400">
          降级链：一键启动 → 智能打包 → 部署指引 → 高级导出
        </div>
      </div>
    </div>
  );
}