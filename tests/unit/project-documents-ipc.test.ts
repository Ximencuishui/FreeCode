/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const shellOpenPath = jest.fn(async () => '');

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  BrowserWindow: { getAllWindows: jest.fn(() => []) },
  dialog: { showOpenDialog: jest.fn() },
  shell: { openPath: shellOpenPath },
}));

import { ipcMain } from 'electron';
import { IpcChannels } from '../../src/shared/types/ipc';
import { registerProjectIpc } from '../../src/main/ipc/project';
import type { StorageManager } from '../../src/main/storage/types';

type IpcHandler = (event: unknown, params: unknown) => Promise<unknown>;

function getHandler(channel: string): IpcHandler {
  const call = (ipcMain.handle as jest.Mock).mock.calls.find((entry) => entry[0] === channel);
  if (!call) throw new Error(`未注册 IPC 通道：${channel}`);
  return call[1] as IpcHandler;
}

function createStorage(codePath: string): StorageManager {
  return {
    getProject: async () => ({
      id: 'project-documents',
      name: '文档测试项目',
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      codePath,
    }),
    getProjectCodePath: () => codePath,
  } as unknown as StorageManager;
}

async function writeFile(filePath: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

describe('项目文档与图片素材 IPC', () => {
  let root: string;
  let codePath: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    shellOpenPath.mockResolvedValue('');
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'freecoder-documents-'));
    codePath = path.join(root, 'project');
    await fs.mkdir(codePath);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('扫描根目录和 docs，列出文档与图片并排除构建目录', async () => {
    await writeFile(path.join(codePath, 'README.md'), '# 项目说明');
    await writeFile(path.join(codePath, 'docs', '技术架构.md'), '# 技术架构');
    await writeFile(path.join(codePath, 'assets', 'logo.svg'), '<svg></svg>');
    await writeFile(path.join(codePath, 'dist', 'ignored.md'), '# 忽略');
    await writeFile(path.join(codePath, 'node_modules', 'ignored.png'), 'ignored');

    registerProjectIpc(createStorage(codePath), {} as never, {} as never, {} as never);
    const result = await getHandler(IpcChannels.projectListDocuments)({}, { projectId: 'project-documents' });

    expect(result).toMatchObject({ success: true });
    const documents = (result as { documents: Array<{ relativePath: string; kind: string }> }).documents;
    expect(documents.map((document) => document.relativePath)).toEqual([
      'README.md',
      'docs/技术架构.md',
      'assets/logo.svg',
    ]);
    expect(documents.find((document) => document.relativePath === 'assets/logo.svg')?.kind).toBe('image');
  });

  it('读取 Markdown 文档，并阻止通过相对路径越出项目目录', async () => {
    await writeFile(path.join(codePath, 'docs', 'guide.md'), '# 使用指南\n\n- 第一项');
    await writeFile(path.join(root, 'secret.md'), '# 不应被读取');
    await writeFile(path.join(codePath, 'src', 'internal.md'), '# 不应被目录扫描器暴露');
    registerProjectIpc(createStorage(codePath), {} as never, {} as never, {} as never);
    const handler = getHandler(IpcChannels.projectReadDocument);

    const readResult = await handler({}, { projectId: 'project-documents', relativePath: 'docs/guide.md' });
    expect(readResult).toMatchObject({ success: true, content: '# 使用指南\n\n- 第一项' });
    // 读取结果同时返回绝对路径，供渲染层用于"绝对路径"复制格式
    expect((readResult as { absolutePath: string }).absolutePath).toBe(
      path.join(codePath, 'docs/guide.md'),
    );

    const traversalResult = await handler(
      {},
      { projectId: 'project-documents', relativePath: '../secret.md' },
    );
    expect(traversalResult).toMatchObject({ success: false, error: { code: 'INVALID_PARAMS' } });

    const internalResult = await handler(
      {},
      { projectId: 'project-documents', relativePath: 'src/internal.md' },
    );
    expect(internalResult).toMatchObject({ success: false, error: { code: 'FILE_IO_ERROR' } });
  });

  it('读取图片为受限的 data URL，并拒绝超过 3 MB 的素材', async () => {
    await writeFile(path.join(codePath, 'assets', 'logo.png'), Buffer.from('png-data'));
    const oversizedPath = path.join(codePath, 'assets', 'large.png');
    await writeFile(oversizedPath, Buffer.alloc(3 * 1024 * 1024 + 1));
    registerProjectIpc(createStorage(codePath), {} as never, {} as never, {} as never);
    const handler = getHandler(IpcChannels.projectReadDocument);

    const imageResult = await handler(
      {},
      { projectId: 'project-documents', relativePath: 'assets/logo.png' },
    );
    expect(imageResult).toMatchObject({
      success: true,
      document: { kind: 'image' },
      asset: { mediaType: 'image/png', alt: 'logo.png' },
    });
    // 读取结果同时返回绝对路径，供渲染层用于"绝对路径"复制格式
    expect((imageResult as { absolutePath: string }).absolutePath).toBe(
      path.join(codePath, 'assets/logo.png'),
    );
    expect((imageResult as { asset: { src: string } }).asset.src).toMatch(
      /^data:image\/png;base64,cG5nLWRhdGE=$/,
    );

    const tooLargeResult = await handler(
      {},
      { projectId: 'project-documents', relativePath: 'assets/large.png' },
    );
    expect(tooLargeResult).toMatchObject({ success: false, error: { code: 'FILE_IO_ERROR' } });
  });

  it('用系统默认应用打开项目内的 SVG，并阻止 Markdown / 越界路径 / 不存在的项目', async () => {
    await writeFile(path.join(codePath, 'assets', 'logo.svg'), '<svg></svg>');
    await writeFile(path.join(codePath, 'README.md'), '# 项目说明');
    await writeFile(path.join(root, 'outside.svg'), '<svg></svg>');
    registerProjectIpc(createStorage(codePath), {} as never, {} as never, {} as never);
    const openHandler = getHandler(IpcChannels.projectOpenAsset);

    // 正常打开：把绝对路径交给 shell.openPath
    const success = await openHandler(
      {},
      { projectId: 'project-documents', relativePath: 'assets/logo.svg' },
    );
    expect(success).toMatchObject({ success: true });
    expect(shellOpenPath).toHaveBeenCalledWith(path.join(codePath, 'assets/logo.svg'));

    // Markdown 不允许外部打开
    const mdResult = await openHandler(
      {},
      { projectId: 'project-documents', relativePath: 'README.md' },
    );
    expect(mdResult).toMatchObject({ success: false, error: { code: 'INVALID_PARAMS' } });

    // 路径穿越：../outside.svg 指向项目之外
    const traversalResult = await openHandler(
      {},
      { projectId: 'project-documents', relativePath: '../outside.svg' },
    );
    expect(traversalResult).toMatchObject({ success: false, error: { code: 'INVALID_PARAMS' } });

    // 不存在的项目
    const noProjectStorage = {
      ...createStorage(codePath),
      getProject: async () => null,
    } as unknown as StorageManager;
    jest.clearAllMocks();
    shellOpenPath.mockResolvedValue('');
    registerProjectIpc(noProjectStorage, {} as never, {} as never, {} as never);
    const noProjectResult = await getHandler(IpcChannels.projectOpenAsset)(
      {},
      { projectId: 'project-documents', relativePath: 'assets/logo.svg' },
    );
    expect(noProjectResult).toMatchObject({ success: false, error: { code: 'PROJECT_NOT_FOUND' } });
  });
});
