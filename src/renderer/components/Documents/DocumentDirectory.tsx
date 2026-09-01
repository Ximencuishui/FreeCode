import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ProjectDocumentSummary } from '@shared/types/project';

interface DocumentDirectoryProps {
  projectId: string;
  selectedPath: string | null;
  onSelect: (relativePath: string) => void;
}

const DEFAULT_OPEN_FOLDERS = ['docs', 'assets', 'public', 'images', 'icons', 'img', 'src'];

interface DocumentTreeNode {
  name: string;
  path: string;
  children: DocumentTreeNode[];
}

function buildDocumentTree(documents: ProjectDocumentSummary[]): DocumentTreeNode[] {
  const root: { children: Map<string, { name: string; path: string; children: Map<string, unknown> }> } = {
    children: new Map(),
  };

  for (const document of documents) {
    const parts = document.relativePath.split('/');
    let level = root;
    let currentPath = '';
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (index === parts.length - 1) {
        level.children.set(part, { name: part, path: currentPath, children: new Map() });
      } else if (!level.children.has(part)) {
        level.children.set(part, { name: part, path: currentPath, children: new Map() });
      }
      const next = level.children.get(part);
      if (!next) break;
      level = { children: next.children as Map<string, { name: string; path: string; children: Map<string, unknown> }> };
    }
  }

  const toNodes = (nodes: Map<string, { name: string; path: string; children: Map<string, unknown> }>): DocumentTreeNode[] =>
    [...nodes.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      .map((node) => ({
        name: node.name,
        path: node.path,
        children: toNodes(node.children as Map<string, { name: string; path: string; children: Map<string, unknown> }>),
      }));

  return toNodes(root.children);
}

function getErrorMessage(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'message' in raw) {
    return String((raw as { message: unknown }).message);
  }
  return '读取文档目录失败';
}

interface FileTreeItemProps {
  document: ProjectDocumentSummary;
  depth: number;
  selectedPath: string | null;
  onSelect: (relativePath: string) => void;
}

function FileTreeItem({ document, depth, selectedPath, onSelect }: FileTreeItemProps) {
  const selected = document.relativePath === selectedPath;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(document.relativePath)}
        title={document.relativePath}
        aria-current={selected ? 'page' : undefined}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
          selected ? 'bg-brand/10 font-medium text-brand' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="w-4 shrink-0 text-center text-sm leading-none" aria-hidden="true">
          {document.kind === 'image' ? '🖼️' : '📄'}
        </span>
        <span className="min-w-0 flex-1 truncate">{document.name}</span>
        {document.kind === 'image' && <span className="shrink-0 text-[9px] text-slate-400">图片</span>}
      </button>
    </li>
  );
}

interface FolderTreeProps {
  node: DocumentTreeNode;
  documents: Map<string, ProjectDocumentSummary>;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (relativePath: string) => void;
}

function FolderTree({
  node,
  documents,
  depth,
  expanded,
  onToggle,
  selectedPath,
  onSelect,
}: FolderTreeProps) {
  const open = expanded.has(node.path);
  const file = documents.get(node.path);
  if (file) {
    return <FileTreeItem document={file} depth={depth} selectedPath={selectedPath} onSelect={onSelect} />;
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className={`w-3 shrink-0 text-[10px] text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">
          ▶
        </span>
        <span className="shrink-0 text-sm leading-none" aria-hidden="true">📁</span>
        <span className="truncate">{node.name}</span>
      </button>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <FolderTree
              key={child.path}
              node={child}
              documents={documents}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function renderTree(
  nodes: DocumentTreeNode[],
  documents: Map<string, ProjectDocumentSummary>,
  expanded: Set<string>,
  onToggle: (path: string) => void,
  selectedPath: string | null,
  onSelect: (relativePath: string) => void,
): ReactNode[] {
  return nodes.map((node) => (
    <FolderTree
      key={node.path}
      node={node}
      documents={documents}
      depth={0}
      expanded={expanded}
      onToggle={onToggle}
      selectedPath={selectedPath}
      onSelect={onSelect}
    />
  ));
}

export default function DocumentDirectory({ projectId, selectedPath, onSelect }: DocumentDirectoryProps) {
  const [documents, setDocuments] = useState<ProjectDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(DEFAULT_OPEN_FOLDERS));
  const [refreshKey, setRefreshKey] = useState(0);
  const selectedPathRef = useRef(selectedPath);
  selectedPathRef.current = selectedPath;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setExpanded(new Set(DEFAULT_OPEN_FOLDERS));
    window.electron.project
      .listDocuments({ projectId })
      .then((result) => {
        if (!active) return;
        if (!result.success) {
          setDocuments([]);
          setError(getErrorMessage(result.error));
          setLoading(false);
          return;
        }
        setDocuments(result.documents);
        setLoading(false);
        if (result.documents.length > 0 && !result.documents.some((item) => item.relativePath === selectedPathRef.current)) {
          onSelect(result.documents[0].relativePath);
        }
      })
      .catch(() => {
        if (!active) return;
        setDocuments([]);
        setError('无法读取项目目录，请检查项目文件后重试');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, refreshKey, onSelect]);

  const documentByPath = useMemo(() => new Map(documents.map((document) => [document.relativePath, document])), [documents]);
  const rootDocuments = documents.filter((document) => !document.relativePath.includes('/'));
  const nestedDocuments = documents.filter((document) => document.relativePath.includes('/'));
  const documentTree = buildDocumentTree(nestedDocuments.filter((document) => document.kind === 'document'));
  const imageTree = buildDocumentTree(nestedDocuments.filter((document) => document.kind === 'image'));
  const documentCount = documents.filter((document) => document.kind === 'document').length;
  const imageCount = documents.length - documentCount;

  const toggleFolder = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /** 选择嵌套文件时展开其所有父目录，避免文件因折叠而不可见 */
  const selectPath = (relativePath: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      const parts = relativePath.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        next.add(parts.slice(0, index).join('/'));
      }
      return next;
    });
    onSelect(relativePath);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">文档目录</h3>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {documentCount} 个文档 · {imageCount} 个素材
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={loading}
          title="刷新文档目录"
          aria-label="刷新文档目录"
          className="rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-wait disabled:opacity-50"
        >
          {loading ? '…' : '↻'}
        </button>
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-xs text-red-600">
          {error}
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)} className="ml-1 underline">
            重试
          </button>
        </div>
      )}

      {!error && loading && (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
          正在扫描项目文档…
        </div>
      )}

      {!error && !loading && documents.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs leading-5 text-slate-500">
          暂未发现 Markdown 文档或图片素材
          <br />
          <span className="text-slate-400">可以请 AI 在项目里补充 README 或使用说明</span>
        </div>
      )}

      {!error && !loading && documents.length > 0 && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {rootDocuments.length > 0 && (
            <ul>
              {rootDocuments.map((document) => (
                <FileTreeItem
                  key={document.relativePath}
                  document={document}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelect={selectPath}
                />
              ))}
            </ul>
          )}
          {documentTree.length > 0 && (
            <ul className="mt-1 border-t border-slate-200 pt-1">
              {renderTree(documentTree, documentByPath, expanded, toggleFolder, selectedPath, selectPath)}
            </ul>
          )}
          {imageTree.length > 0 && (
            <div className="mt-1 border-t border-slate-200 pt-1">
              <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">图片素材</p>
              <ul>
                {renderTree(imageTree, documentByPath, expanded, toggleFolder, selectedPath, selectPath)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
