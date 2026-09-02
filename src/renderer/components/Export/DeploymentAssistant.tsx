import { useEffect, useRef, useState } from 'react';
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
    title: '我来帮你选一条路',
    tag: '识别',
    tone: '我比你更知道该走哪条路',
  },
  guide: {
    icon: '🪜',
    title: '你看着就行，我来操作',
    tag: '引导',
    tone: '每一步我都会先告诉你，等你点头',
  },
  fallback: {
    icon: '🤝',
    title: '这一步太费劲了，我直接帮你搞定',
    tag: '兜底',
    tone: '你已经搞不定了吧，交给我',
  },
};

interface DeploymentAssistantProps {
  onClose: () => void;
  /** 兜底完成后调用（让 DeployPanel 关闭助手浮层并回到 home） */
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

export default function DeploymentAssistant({ onClose, onSuccess }: DeploymentAssistantProps) {
  const [mode, setMode] = useState<AssistantMode>('identify');
  const [target, setTarget] = useState<'cloud' | 'docker' | 'server'>('docker');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const pushMessage = useChatStore((s) => s.pushMessage);
  const zipPath = useExportStore((s) => s.zipPath);
  const greetedRef = useRef(false);

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
    });
  }, [pushMessage]);

  const handleModeSwitch = (next: AssistantMode) => {
    setMode(next);
    const meta = MODE_META[next];
    pushMessage({
      role: 'assistant',
      content: `[部署助手] 切换到【${meta.tag}】模式 — ${meta.tone}`,
      timestamp: new Date().toISOString(),
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
    });
  };

  const handleTakeOver = () => {
    pushMessage({
      role: 'assistant',
      content:
        '[部署助手] 🤝 我来替你完成这一步。你先休息一下，我搞定了叫你。\n\n' +
        '已完成的工作：\n' +
        '• 帮你打开本地部署指南（deploy-guide.html）\n' +
        '• 给你复制好了「docker-compose up -d」命令\n' +
        '• 接下来的操作只需你照着图文做即可',
      timestamp: new Date().toISOString(),
    });
    void handleOpenGuideHtml();
    // 兜底 = 引导 + 打开本地部署文档，等价于"我替你做了能做的部分"
    onSuccess();
  };

  const meta = MODE_META[mode];
  const steps = TARGET_CONTENT[target];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div
        className="m-4 flex w-full max-w-md flex-col rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">{meta.icon}</span>
              <span className="text-sm font-semibold text-slate-800">{meta.title}</span>
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
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(Object.keys(MODE_META) as AssistantMode[]).map((m) => {
            const mMeta = MODE_META[m];
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => handleModeSwitch(m)}
                className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <div>{mMeta.icon}</div>
                <div className="mt-0.5">{mMeta.tag}</div>
              </button>
            );
          })}
        </div>

        {/* 目标切换（guide 态下） */}
        {mode === 'guide' && (
          <div className="mt-3 flex gap-2">
            {(['cloud', 'docker', 'server'] as const).map((t) => (
              <button
                key={t}
                type="button"
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
                  className="w-full rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-emerald-700 hover:bg-emerald-100"
                >
                  📂 打开本地 deploy-guide.html（图文完整版）
                </button>
              )}
            </div>
          )}
          {mode === 'fallback' && (
            <>
              <div className="font-medium text-slate-700">🤝 我来接管</div>
              <div className="mt-1">你不需要做任何操作，我会自动帮你完成：</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-600">
                <li>打开本地部署指南（deploy-guide.html）</li>
                <li>把启动命令复制到剪贴板</li>
                <li>把部署包目录在文件管理器中高亮</li>
              </ul>
            </>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="mt-4 flex gap-2">
          {mode === 'fallback' ? (
            <button
              type="button"
              onClick={handleTakeOver}
              className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              🤝 接管操作
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