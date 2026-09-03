import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { ProjectDocumentSummary } from '@shared/types/project';

interface DocumentDirectoryProps {
  projectId: string;
  selectedPath: string | null;
  onSelect: (relativePath: string) => void;
}

const DEFAULT_OPEN_FOLDERS = ['docs', 'assets', 'public', 'images', 'icons', 'img', 'src'];

function getExpandedStorageKey(projectId: string): string {
  return `fc-doc-tree:expanded:${projectId}`;
}
function getSelectedStorageKey(projectId: string): string {
  return `fc-doc-tree:selected:${projectId}`;
}

/** v3.2.1 P1-8：按项目保留展开状态——
 * 之前切项目时无条件重置成 DEFAULT_OPEN_FOLDERS，导致用户在某个项目里手动展开的"drafts/"等
 * 自定义目录在切换后丢失，必须重新展开。现在用 localStorage 按 projectId 分别保存，
 * 切换项目互不干扰。 */
function loadExpanded(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(getExpandedStorageKey(projectId));
    if (!raw) return new Set(DEFAULT_OPEN_FOLDERS);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    /* 解析失败走默认 */
  }
  return new Set(DEFAULT_OPEN_FOLDERS);
}
function saveExpanded(projectId: string, expanded: Set<string>): void {
  try {
    localStorage.setItem(getExpandedStorageKey(projectId), JSON.stringify([...expanded]));
  } catch {
    /* 写入失败（隐私模式等）忽略 */
  }
}
function loadSelected(projectId: string): string | null {
  try {
    return localStorage.getItem(getSelectedStorageKey(projectId));
  } catch {
    return null;
  }
}

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

/** 把图片素材按顶层目录分组（用于在文档目录里分块展示，避免所有图片挤在一个"图片素材"标题下）。
 * v0.1.02 P2-7：原本所有图片统一打上 category='asset' 并塞在同一个"图片素材"分组里，
 * 但图片在文件系统中天然就有目录结构（assets/、public/、images/、icons/、img/），
 * 直接用顶层目录名作为分组标题，更符合用户直觉（README/需求/版本计划/技术/测试…）。
 * 项目根目录下的图片（如 logo.svg 直接放在根目录）归到"项目根"组。 */
function groupImagesByTopDir(images: ProjectDocumentSummary[]): Map<string, ProjectDocumentSummary[]> {
  const map = new Map<string, ProjectDocumentSummary[]>();
  for (const image of images) {
    const first = image.relativePath.split('/')[0] ?? image.name;
    const bucket = first === image.name ? '项目根' : first;
    const list = map.get(bucket) ?? [];
    list.push(image);
    map.set(bucket, list);
  }
  return map;
}

/** 顶层目录显示顺序：常见资源目录在前，其它按字母 */
const IMAGE_BUCKET_ORDER = ['assets', 'public', 'images', 'icons', 'img', '项目根'];

function sortImageBuckets(keys: Iterable<string>): string[] {
  const arr = [...keys];
  return arr.sort((a, b) => {
    const ai = IMAGE_BUCKET_ORDER.indexOf(a);
    const bi = IMAGE_BUCKET_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, 'zh-CN');
  });
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
  /** v3.2.1 P1-2：ARIA tree 规范要求每个 treeitem 标注兄弟总数与自身位置，
   *  屏幕阅读器朗读"第 3 项 / 共 12 项"——便于键盘用户在深嵌套目录里定位。
   *  顶层调用者传入，递归内部由 FolderTree 透传。 */
  setsize?: number;
  posinset?: number;
}

function FileTreeItem({
  document,
  depth,
  selectedPath,
  onSelect,
  setsize,
  posinset,
}: FileTreeItemProps) {
  const selected = document.relativePath === selectedPath;
  return (
    <li data-tree-collapsed="false">
      <button
        type="button"
        onClick={() => onSelect(document.relativePath)}
        title={document.relativePath}
        // v0.1.02 P3-AUDIT：ARIA tree 的选中态用 aria-selected 表达；aria-current="page"
        // 是导航链接的语义（"当前页"），跟 treeitem 无关。两者同时存在会重复且让 SR 多读一次。
        role="treeitem"
        aria-selected={selected}
        aria-level={depth + 1}
        aria-setsize={setsize}
        aria-posinset={posinset}
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
  /** v3.2.1 P1-2：兄弟节点元信息，用于 ARIA setsize / posinset 标注 */
  setsize?: number;
  posinset?: number;
}

function FolderTree({
  node,
  documents,
  depth,
  expanded,
  onToggle,
  selectedPath,
  onSelect,
  setsize,
  posinset,
}: FolderTreeProps) {
  const open = expanded.has(node.path);
  const file = documents.get(node.path);
  if (file) {
    return (
      <FileTreeItem
        document={file}
        depth={depth}
        selectedPath={selectedPath}
        onSelect={onSelect}
        setsize={setsize}
        posinset={posinset}
      />
    );
  }

  return (
    <li data-tree-collapsed={!open}>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        aria-expanded={open}
        role="treeitem"
        aria-level={depth + 1}
        aria-setsize={setsize}
        aria-posinset={posinset}
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
        <ul role="group">
          {node.children.map((child, idx) => (
            <FolderTree
              key={child.path}
              node={child}
              documents={documents}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedPath={selectedPath}
              onSelect={onSelect}
              setsize={node.children.length}
              posinset={idx + 1}
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
  return nodes.map((node, idx) => (
    <FolderTree
      key={node.path}
      node={node}
      documents={documents}
      depth={0}
      expanded={expanded}
      onToggle={onToggle}
      selectedPath={selectedPath}
      onSelect={onSelect}
      setsize={nodes.length}
      posinset={idx + 1}
    />
  ));
}

export default function DocumentDirectory({ projectId, selectedPath, onSelect }: DocumentDirectoryProps) {
  const [documents, setDocuments] = useState<ProjectDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // v3.2.1 P1-8：从 localStorage 恢复上次该项目的展开状态，而不是无脑重置。
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(projectId));
  const [refreshKey, setRefreshKey] = useState(0);
  // v3.2.1 P1-9：按文件名/相对路径模糊匹配；非空时自动展开所有匹配项的父目录。
  const [searchQuery, setSearchQuery] = useState('');
  const selectedPathRef = useRef(selectedPath);
  selectedPathRef.current = selectedPath;

  // v3.2.1 P1-8：切项目时重新加载该项目的展开/选中状态。refreshKey 也参与以便"刷新"按钮重置。
  useEffect(() => {
    setExpanded(loadExpanded(projectId));
  }, [projectId, refreshKey]);
  useEffect(() => {
    saveExpanded(projectId, expanded);
  }, [projectId, expanded]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
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
        // v3.2.1 P2-13：恢复上次该项目的选中文件（仅在当前没传 selectedPath 时）
        // 同时兜底：如果 selectedPath 不在新文档列表里，选第一个文档
        const remembered = loadSelected(projectId);
        const current = selectedPathRef.current;
        const validPaths = new Set(result.documents.map((d) => d.relativePath));
        if (current && validPaths.has(current)) {
          // 保留当前
        } else if (remembered && validPaths.has(remembered)) {
          onSelect(remembered);
        } else if (result.documents.length > 0) {
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
  // v0.1.02 P2-7：图片按顶层目录分组（assets / public / icons …），而不是硬编码"图片素材"分组。
  // 顶层目录名作为分组标题，更贴近文件系统实际布局；"项目根"组专门收纳直接放在项目根的图片。
  // 每个组内仍用原始相对路径（documentByPath 已按原始路径索引）渲染子树，
  // 但渲染时跳过最外层顶层目录节点（因为它的名字已经在分组标题里展示了）。
  // v3.2.1 P2-14：统一图片分组逻辑——直接对所有 kind='image' 的文档调用
  // groupImagesByTopDir，无需先按 rootDocuments/nestedDocuments 拆分。
  // 旧实现先拆 root + nested 再合并，再二次 filter `split('/')[0] === bucket` 冗余，
  // 现在 groupImagesByTopDir 已经按 first segment 分好（无 '/' 的归"项目根"组），
  // 直接用即可。语义统一：文档树用 nestedDocuments 的 kind='document'；图片用全量 kind='image'。
  const imageGroups = useMemo(() => {
    const imageDocs = documents.filter((d) => d.kind === 'image');
    const map = groupImagesByTopDir(imageDocs);
    return sortImageBuckets(map.keys())
      .map((bucket) => ({
        bucket,
        tree: buildDocumentTree(map.get(bucket) ?? []),
      }))
      // v3.2.1 P1-8：过滤空分组。如果 buildDocumentTree 之后树为空（例如
      // 目录被过滤掉了所有图片），就不渲染这个分组卡片，避免用户看到"📷 0 张"的空卡。
      .filter((g) => g.tree.length > 0);
  }, [documents]);
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
    // v3.2.1 P1-8：把当前选中路径写到 localStorage，下次回该项目时恢复
    try {
      localStorage.setItem(getSelectedStorageKey(projectId), relativePath);
    } catch {
      /* 忽略 */
    }
    onSelect(relativePath);
  };

  // v3.2.1 P1-9：搜索结果 = 匹配文件名或相对路径的文件项。空 query 返回 null 表示走原视图。
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return null;
    return documents
      .filter(
        (d) =>
          d.name.toLowerCase().includes(trimmedQuery) ||
          d.relativePath.toLowerCase().includes(trimmedQuery),
      )
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN'));
  }, [documents, trimmedQuery]);

  // v0.1.02 P3-1：在文档目录树里支持键盘导航（Tree WAI-ARIA pattern）。
  // 之前目录树只能鼠标点击，键盘用户只能 Tab 一项一项切，对深嵌套结构很慢。
  // 实现要点：
  // 1. 通过事件委托在根容器上监听 keydown，不需要给每个 button 单独绑 ref；
  // 2. 可见性判断：递归向上找最近的折叠 li（data-tree-collapsed="true"），在折叠子树里的按钮跳过；
  // 3. ArrowDown/Up 在可见项之间循环；Home/End 跳转首尾；ArrowRight 展开文件夹，ArrowLeft 折叠；
  // 4. 文件夹展开后焦点保持原位，方便继续按 → 进入第一个子项（用户连续按两次 ↑/↓/→/← 即可导航）。
  const handleTreeKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const root = e.currentTarget;
    const items = Array.from(root.querySelectorAll<HTMLButtonElement>('button[role="treeitem"]'));
    if (items.length === 0) return;
    const isVisible = (btn: HTMLButtonElement): boolean => {
      // 排除掉被折叠的祖先子树中的按钮
      let parent: HTMLElement | null = btn.parentElement;
      while (parent && parent !== root) {
        if (parent.dataset.treeCollapsed === 'true') return false;
        parent = parent.parentElement;
      }
      return btn.offsetParent !== null;
    };
    const visibleItems = items.filter(isVisible);
    if (visibleItems.length === 0) return;
    const activeEl = document.activeElement;
    const currentIdx =
      activeEl instanceof HTMLElement && visibleItems.includes(activeEl as HTMLButtonElement)
        ? visibleItems.indexOf(activeEl as HTMLButtonElement)
        : -1;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = currentIdx === -1 ? 0 : Math.min(visibleItems.length - 1, currentIdx + 1);
        visibleItems[next]?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = currentIdx === -1 ? 0 : Math.max(0, currentIdx - 1);
        visibleItems[prev]?.focus();
        break;
      }
      case 'Home': {
        e.preventDefault();
        visibleItems[0]?.focus();
        break;
      }
      case 'End': {
        e.preventDefault();
        visibleItems[visibleItems.length - 1]?.focus();
        break;
      }
      case 'ArrowRight': {
        if (currentIdx === -1) return;
        e.preventDefault();
        const item = visibleItems[currentIdx];
        if (item.getAttribute('aria-expanded') === 'false') {
          // 折叠 → 展开
          item.click();
        }
        break;
      }
      case 'ArrowLeft': {
        if (currentIdx === -1) return;
        e.preventDefault();
        const item = visibleItems[currentIdx];
        if (item.getAttribute('aria-expanded') === 'true') {
          // 展开 → 折叠
          item.click();
        }
        break;
      }
      default:
        break;
    }
  }, []);

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

      {/* v3.2.1 P1-9：搜索框——按文件名 / 相对路径模糊匹配，空查询时走原树形视图。 */}
      <div className="mt-2 flex shrink-0 items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索文件名或路径…"
          aria-label="搜索文档"
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs outline-none transition-colors focus:border-brand"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="text-[11px] text-slate-400 transition-colors hover:text-slate-700"
            aria-label="清除搜索"
          >
            ✕
          </button>
        )}
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
        <div
          className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1"
          role="tree"
          aria-label="项目文档与图片目录"
          onKeyDown={handleTreeKeyDown}
        >
          <p className="mb-1 px-2 text-[10px] text-slate-400" aria-hidden="true">
            {searchResults
              ? `搜索结果 ${searchResults.length} 个 · Enter 选择文件`
              : '提示：方向键导航 · ←/→ 折叠/展开文件夹 · Enter 选择文件'}
          </p>
          {searchResults ? (
            // v3.2.1 P1-9：搜索模式 —— 折叠所有文件夹，只把匹配的文件平铺出来
            searchResults.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-slate-400">
                没有匹配「{searchQuery.trim()}」的文档
              </p>
            ) : (
              <ul role="presentation">
                {searchResults.map((document, idx) => (
                  <FileTreeItem
                    key={document.relativePath}
                    document={document}
                    depth={0}
                    selectedPath={selectedPath}
                    onSelect={selectPath}
                    setsize={searchResults.length}
                    posinset={idx + 1}
                  />
                ))}
              </ul>
            )
          ) : (
            <>
              {rootDocuments.length > 0 && (
                <ul role="presentation">
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
                <ul className="mt-1 border-t border-slate-200 pt-1" role="presentation">
                  {renderTree(documentTree, documentByPath, expanded, toggleFolder, selectedPath, selectPath)}
                </ul>
              )}
              {imageGroups.length > 0 && (
                <div className="mt-1 border-t border-slate-200 pt-1" role="presentation">
                  {/* v0.1.02 P2-7：每个图片顶层目录作为独立的分组，标题用真实目录名而不是硬编码"图片素材" */}
                  {imageGroups.map((group, groupIdx) => (
                    <div
                      key={group.bucket}
                      className={groupIdx > 0 ? 'mt-1 border-t border-slate-100 pt-1' : ''}
                      data-image-group={group.bucket}
                    >
                      <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        🖼 {group.bucket}
                      </p>
                      <ul role="presentation">
                        {group.bucket === '项目根'
                          ? // 项目根组：图片都是顶层节点，直接平铺
                            group.tree.map((node) => (
                              <FolderTree
                                key={node.path}
                                node={node}
                                documents={documentByPath}
                                depth={0}
                                expanded={expanded}
                                onToggle={toggleFolder}
                                selectedPath={selectedPath}
                                onSelect={selectPath}
                              />
                            ))
                          : // 命名目录组：跳过最外层目录节点（名字已在分组标题展示），从子节点开始
                            renderTree(
                              group.tree.flatMap((top) => top.children),
                              documentByPath,
                              expanded,
                              toggleFolder,
                              selectedPath,
                              selectPath,
                            )}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
