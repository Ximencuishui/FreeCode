import { useState } from 'react';
import { useExportStore } from '../../store/export';
import { useProjectStore } from '../../store/project';
import DeployConfigWizard from './DeployConfigWizard';
import { createDefaultDeployConfig } from '@shared/types/export';
import type { DeployConfig } from '@shared/types/export';

/**
 * 导出部署包面板（前端设计说明书 3.6）。
 * 打开后先进入「上线配置向导」，配置完成后再执行导出。
 */
export default function ExportPanel() {
  const visible = useExportStore((s) => s.visible);
  const exporting = useExportStore((s) => s.exporting);
  const done = useExportStore((s) => s.done);
  const zipPath = useExportStore((s) => s.zipPath);
  const error = useExportStore((s) => s.error);
  const close = useExportStore((s) => s.close);
  const startExport = useExportStore((s) => s.startExport);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // 面板重新打开时组件重新挂载，配置恢复默认
  const [stage, setStage] = useState<'wizard' | 'export'>('wizard');
  const [config, setConfig] = useState<DeployConfig>(() => createDefaultDeployConfig());

  if (!visible) return null;

  const handleExport = () => {
    if (currentProjectId) void startExport(currentProjectId, config);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={close}
    >
      <div
        className={`flex max-h-[85vh] w-full flex-col rounded-2xl bg-white p-6 shadow-xl ${
          stage === 'wizard' ? 'max-w-2xl' : 'max-w-md'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {stage === 'wizard' ? (
          <DeployConfigWizard
            config={config}
            onChange={setConfig}
            onFinish={() => setStage('export')}
            onClose={close}
          />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">📦 导出部署包</h2>
              <button
                type="button"
                onClick={close}
                className="text-slate-400 hover:text-slate-600"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-slate-600">您的应用已准备就绪！即将导出完整的部署包。</p>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <div className="mb-1.5 font-medium text-slate-700">📁 导出内容包括：</div>
              <ul className="space-y-1">
                <li>✅ 项目源码</li>
                <li>✅ Dockerfile + docker-compose.yml</li>
                <li>✅ 已填好密钥的 .env 配置</li>
                <li>✅ 中文部署指引</li>
              </ul>
            </div>

            <p className="mt-3 text-xs text-slate-400">
              💡 导出的部署包可在任何支持 Docker 的服务器上运行
            </p>

            {exporting && (
              <div className="mt-4 text-center text-sm text-slate-500">正在打包部署包…</div>
            )}

            {done && (
              <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
                ✅ 导出完成！部署包已保存到：
                <div className="mt-1 break-all font-mono text-xs">{zipPath}</div>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStage('wizard')}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                修改配置
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                完成
              </button>
              <button
                type="button"
                disabled={exporting || !currentProjectId}
                onClick={handleExport}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {done ? '再次导出' : '📥 导出部署包'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
