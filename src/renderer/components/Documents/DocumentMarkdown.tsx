import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

interface DocumentMarkdownProps {
  content: string;
  className?: string;
}

/**
 * v3.2.2 P1-14：图片点击放大预览状态。
 * 点击内嵌图片 → 弹层显示原 URL + 文件名 + Esc / 点遮罩关闭。
 * 图片 URL 是由 docsGenerator 写盘时落地的 file:// 路径（已通过项目白名单校验），
 * 直接 <img src={url}> 渲染，Desktop / Web 都能跑。
 */
interface FullscreenImage {
  src: string;
  alt: string;
}

/**
 * v3.2.2 P1-14：模块级 ref 持有当前 DocumentMarkdown 的 openFullscreen。
 * renderInline / renderBlock 在模块顶层定义，无法直接读组件闭包；
 * 改用模块级 ref + 在 DocumentMarkdown 每次 render 同步覆盖 current，
 * 避免给 5 个 render 函数逐个加 openFullscreen 参数（heading / paragraph / quote /
 * table / list / nested list 全要透传，污染大）。ref 而非模块变量，更利于测试时 reset。
 */
const fullscreenOpenerRef: { current: (img: FullscreenImage) => void } = {
  current: () => {
    /* 默认 noop；DocumentMarkdown mount 后会被覆盖 */
  },
};

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'rule' };

/**
 * v0.1.02 P3-3：列表项支持嵌套。children 与父项用同样的 ordered / unordered 格式，
 * 渲染成嵌套 <ul>/<ol>，与 GFM 一致。深度上限 6 层（再深就一锅炖，不再分块）。
 */
interface ListItem {
  text: string;
  ordered: boolean;
  children: ListItem[];
}

const INLINE_TOKEN = /(\x60[^\x60]+\x60|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|\*[^*]+\*|_[^_]+_)/g;

function isBlank(line: string): boolean {
  return !line.trim();
}

function isRawHtml(line: string): boolean {
  return /^<\/?[A-Za-z][^>]*>$/.test(line.trim());
}

/**
 * v0.1.02 P3-3：HTML 注释 `<!-- ... -->` 检测（可跨多行）。
 * 仅用于解析阶段跳过整段注释，避免被当成普通段落渲染。
 */
function isHtmlCommentStart(line: string): boolean {
  return /<!--/.test(line);
}

function isHtmlCommentEnd(line: string): boolean {
  return /-->/.test(line);
}

/**
 * v0.1.02 P3-3：常见 HTML 实体解码（仅处理解析阶段的纯文本流，不涉及安全过滤）。
 * 覆盖 &amp; / &lt; / &gt; / &quot; / &#39; / &nbsp; / 数字 / 十六进制引用，
 * 其余原样保留（按字面量输出），与 GFM 的解码范围一致。
 */
const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  middot: '·',
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      // v0.1.02 P3-AUDIT：String.fromCodePoint 对 < 0 / > 0x10FFFF 抛 RangeError，
      // 会让整个 markdown 解析直接崩。编码越界 / 非数字 / 负数都保留原样（match）。
      if (!Number.isNaN(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return match;
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      if (!Number.isNaN(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return match;
    }
    const named = HTML_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function isFenceStart(line: string): boolean {
  return /^\s*(\x60{3}|~~~)/.test(line);
}

function isTableDelimiter(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    isBlank(line) ||
    isFenceStart(line) ||
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    /^ {0,3}>\s?/.test(line) ||
    /^ {0,3}[-*+]\s+/.test(line) ||
    /^ {0,3}\d+\.\s+/.test(line) ||
    (index + 1 < lines.length && isTableDelimiter(lines[index + 1])) ||
    isRawHtml(line)
  );
}

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    // v0.1.02 P3-3：HTML 注释整段跳过（支持跨行 `<!-- ... -->`）
    if (isHtmlCommentStart(line)) {
      if (isHtmlCommentEnd(line)) {
        index += 1;
        continue;
      }
      // 跨行注释：消耗到 `-->` 出现为止
      index += 1;
      while (index < lines.length && !isHtmlCommentEnd(lines[index])) index += 1;
      if (index < lines.length) index += 1;
      continue;
    }
    if (isBlank(line) || isRawHtml(line)) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*(\x60{3}|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      const language = fence[2] || 'text';
      const codeLines: string[] = [];
      index += 1;
      const fencePattern = '^\\s*' + (fence[1] === '~' ? '~{3}' : '\\x60{3}') + '\\s*$';
      while (index < lines.length && !new RegExp(fencePattern).test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        type: 'code',
        language,
        content: codeLines.join('\n').replace(/^\n|\n$/g, ''),
      });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && splitTableRow(lines[index]).length === headers.length) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }

    const unordered = /^\s{0,3}[-*+]\s+/.test(line);
    const ordered = /^\s{0,3}\d+\.\s+/.test(line);
    if (unordered || ordered) {
      // v0.1.02 P3-3：嵌套列表。检测每个子行的"缩进 + 标记符"，与当前父层对齐则平铺，
      // 缩进更深则作为上一层 item 的 children。父层 ordered / unordered 类型可不同，
      // 子项跟随自身标记（更符合 GFM 实际渲染）。
      const root: { ordered: boolean; indent: number; item: ListItem | null; children: ListItem[] } = {
        ordered,
        indent: line.match(/^\s*/)?.[0].length ?? 0,
        item: null,
        children: [],
      };
      const stack: Array<{ ordered: boolean; indent: number; item: ListItem | null; children: ListItem[] }> = [root];
      while (index < lines.length) {
        const cur = lines[index];
        const uMatch = cur.match(/^(\s*)[-*+]\s+(.*)$/);
        const oMatch = cur.match(/^(\s*)\d+\.\s+(.*)$/);
        if (!uMatch && !oMatch) break;
        const indent = (uMatch?.[1] ?? oMatch?.[1] ?? '').length;
        const text = (uMatch?.[2] ?? oMatch?.[2] ?? '').trimEnd();
        const isOrdered = !!oMatch;
        // 缩进回退到顶层：弹出 stack 直到 indent <= 当前栈顶 indent
        while (stack.length > 1 && indent <= (stack[stack.length - 1].indent ?? 0)) {
          stack.pop();
        }
        const parent = stack[stack.length - 1];
        const nodeItem: ListItem = { text, ordered: isOrdered, children: [] };
        parent.children.push(nodeItem);
        stack.push({ ordered: isOrdered, indent, item: nodeItem, children: nodeItem.children });
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items: root.children });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

function isSafeLink(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url.trim());
}

/**
 * v3.2.2 P1-13：从链接 URL 推断协议标签，给降级 <span> 的 title 用。
 * 例如 `file:///foo` → "本地文件链接（file）"，`javascript:alert(1)` → "JavaScript 链接（javascript）"。
 * 协议无法识别时（如相对路径 `./foo.md`）回退为 "内部链接"，提示用户去项目目录查看。
 */
function describeLinkProtocol(url: string): string {
  const trimmed = url.trim();
  // 锚点 / 相对路径
  if (trimmed.startsWith('#') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return '内部锚点 / 相对路径';
  }
  // 带协议：提取 scheme
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    return `${schemeMatch[1]} 链接`;
  }
  // 没协议：相对路径（如 docs/foo.md）
  if (trimmed.startsWith('/') || /^[a-zA-Z0-9_.-]/.test(trimmed)) {
    return '相对路径（项目内文件）';
  }
  return '未知链接类型';
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  INLINE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;
  let tokenIndex = 0;

  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    const token = match[0];
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const key = `${keyPrefix}-${tokenIndex}`;
    tokenIndex += 1;
    if (token.startsWith('!')) {
      // v3.2.2 P1-14：内嵌图片改为可点击预览。解析出的 image URL 是 docsGenerator
      // 写入的真实路径（file:// 或项目内相对路径），点击 → openFullscreen → 全屏弹层。
      // 之前只渲染一个 🖼 标签 + alt，用户看不到实际图，体验很弱。
      const image = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      const alt = image?.[1] || '图片';
      const src = image?.[2] ?? '';
      if (src) {
        nodes.push(
          <button
            key={key}
            type="button"
            onClick={() => fullscreenOpenerRef.current({ src, alt })}
            className="group inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-500 transition-colors hover:border-brand hover:text-brand"
            title="点击查看大图"
          >
            <span aria-hidden="true">🖼</span>
            <span>{alt}</span>
          </button>,
        );
      } else {
        nodes.push(
          <span key={key} className="rounded bg-slate-100 px-1 text-xs text-slate-500">
            🖼 {alt}
          </span>,
        );
      }
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const label = link[1];
        const url = link[2].trim();
        nodes.push(
          isSafeLink(url) ? (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-brand underline underline-offset-2"
            >
              {label}
            </a>
          ) : (
            // v3.2.2 P1-13：非 http(s)/mailto 链接（file:// / 内部锚点 / 相对路径 / 协议未识别）降级为 <span>。
            // 加 title 提示协议类型，避免用户以为是死链 / 漏看 → 现在鼠标 hover 看到
            // "本地文件链接（file）· 暂不支持在文档内打开" 之类说明。
            <span
              key={key}
              className="text-slate-500 underline decoration-dotted"
              title={`${describeLinkProtocol(url)} · 当前文档预览暂不支持打开，已降级为文本`}
            >
              {label}
            </span>
          ),
        );
      } else {
        // v0.1.02 P3-3：剩余的纯文本片段也要解码 HTML 实体（&amp; → & 等）
        nodes.push(decodeHtmlEntities(token));
      }
    }
    cursor = match.index + token.length;
  }

  // v0.1.02 P3-3：尾部剩余纯文本也解码实体
  if (cursor < text.length) nodes.push(decodeHtmlEntities(text.slice(cursor)));
  return nodes;
}

function renderListItemText(item: ListItem, key: string): ReactNode {
  const task = item.text.match(/^\[([ xX])\]\s+(.*)$/);
  if (!task) return <span>{renderInline(item.text, key)}</span>;
  const checked = task[1].toLowerCase() === 'x';
  return (
    <span className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={`mt-1.5 h-3.5 w-3.5 shrink-0 rounded border ${
          checked ? 'border-emerald-500 bg-emerald-500 text-[9px] leading-[13px] text-white' : 'border-slate-300'
        }`}
      >
        {checked ? '✓' : ''}
      </span>
      <span className={checked ? 'text-slate-500 line-through' : ''}>{renderInline(task[2], key)}</span>
    </span>
  );
}

/** v0.1.02 P3-3：递归渲染嵌套列表（ListItem.children） */
function renderListItems(items: ListItem[], keyPrefix: string, ordered: boolean): ReactNode {
  const Tag = ordered ? 'ol' : 'ul';
  const listClass = ordered
    ? 'list-decimal space-y-1.5 pl-6'
    : 'list-disc space-y-1.5 pl-6';
  return (
    <Tag key={keyPrefix} className={`my-1 ${listClass} text-sm text-slate-700`}>
      {items.map((item, index) => {
        const liClass = ordered ? '' : 'pl-1 marker:text-slate-400';
        return (
          <li key={`${keyPrefix}-${index}`} className={liClass}>
            {renderListItemText(item, `${keyPrefix}-${index}`)}
            {item.children.length > 0 && (
              // 嵌套子项：ordered / unordered 跟随子项自身的 ordered 字段（与 GFM 一致）。
              // 但首层通常希望统一缩进 → 这里子层都按 ul 处理；如有 ordered 子项就在内部再次分支。
              renderNestedChildren(item.children, `${keyPrefix}-${index}-nested`)
            )}
          </li>
        );
      })}
    </Tag>
  );
}

function renderNestedChildren(items: ListItem[], keyPrefix: string): ReactNode {
  // 子项中可能混排 ordered / unordered，逐项判断比预聚合更简单
  const groups: Array<{ ordered: boolean; items: ListItem[] }> = [];
  let current: { ordered: boolean; items: ListItem[] } | null = null;
  for (const item of items) {
    if (!current || current.ordered !== item.ordered) {
      current = { ordered: item.ordered, items: [item] };
      groups.push(current);
    } else {
      current.items.push(item);
    }
  }
  return (
    <>
      {groups.map((g, gi) => renderListItems(g.items, `${keyPrefix}-g${gi}`, g.ordered))}
    </>
  );
}

function renderBlock(block: MarkdownBlock, key: string): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level, 6)}` as keyof JSX.IntrinsicElements;
      const sizes: Record<number, string> = {
        1: 'mt-9 mb-4 text-2xl font-semibold tracking-tight text-slate-900',
        2: 'mt-8 mb-3 text-xl font-semibold tracking-tight text-slate-900',
        3: 'mt-7 mb-3 text-lg font-semibold text-slate-800',
        4: 'mt-6 mb-2 text-base font-semibold text-slate-800',
        5: 'mt-5 mb-2 text-sm font-semibold text-slate-800',
        6: 'mt-5 mb-2 text-sm font-medium text-slate-600',
      };
      return (
        <Tag key={key} className={sizes[block.level] ?? sizes[6]}>
          {renderInline(block.text, key)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="my-3 text-sm leading-7 text-slate-700">
          {renderInline(block.text, key)}
        </p>
      );
    case 'code':
      return (
        <div key={key} className="my-5 overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
          <div className="border-b border-slate-700 px-4 py-2 text-[10px] uppercase tracking-wider text-slate-400">
            {block.language}
          </div>
          <pre className="overflow-x-auto p-4 text-xs leading-5 text-slate-100">
            <code>{block.content || ' '}</code>
          </pre>
        </div>
      );
    case 'quote':
      return (
        <blockquote key={key} className="my-4 border-l-2 border-brand/40 bg-brand/5 px-4 py-2 text-sm text-slate-600">
          {renderInline(block.text, key)}
        </blockquote>
      );
    case 'list':
      return renderListItems(block.items, key, block.ordered);
    case 'table':
      return (
        <div key={key} className="my-5 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-left text-xs text-slate-700">
            <thead className="bg-slate-50 font-semibold text-slate-800">
              <tr>
                {block.headers.map((header, index) => (
                  <th key={`${key}-head-${index}`} className="border-b border-slate-200 px-3 py-2">
                    {renderInline(header, `${key}-head-${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-${rowIndex}-${cellIndex}`} className="border-b border-slate-100 px-3 py-2 last:border-0">
                      {renderInline(cell, `${key}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr key={key} className="my-6 border-slate-200" />;
  }
}

export default function DocumentMarkdown({ content, className = '' }: DocumentMarkdownProps) {
  // v3.2.2 P1-14：点击图片 → 全屏预览。null 时不渲染弹层，避免一直挂在 DOM 上。
  const [fullscreen, setFullscreen] = useState<FullscreenImage | null>(null);
  // 修复 P0-2：图片加载状态。null=未尝试 loading=加载中 loaded=成功 error=失败（展示降级 UI）
  const [fullscreenStatus, setFullscreenStatus] = useState<'loading' | 'loaded' | 'error' | null>(null);
  // v3.2.2 P1-14-2：全屏弹层 ref，用于 mount 后 autoFocus 让 ESC 立即生效
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const openFullscreen = (img: FullscreenImage): void => {
    setFullscreenStatus('loading');
    setFullscreen(img);
  };
  const closeFullscreen = (): void => {
    setFullscreen(null);
    setFullscreenStatus(null);
  };
  /** 修复 P0-2：图片加载成功 — 切到 loaded 态。Webview 跨域图加载时不抛错，静默成功即可。 */
  const handleFullscreenLoad = (): void => setFullscreenStatus('loaded');
  /** 修复 P0-2：图片加载失败 — 切到 error 态，让弹层展示降级 UI 而不是空白黑洞。
   *  项目切走/文件被删/路径白名单未通过 都会触发这层；失败时把 src 展示给用户，便于排查。 */
  const handleFullscreenError = (): void => setFullscreenStatus('error');
  // v3.2.2 P1-14：每次 render 同步覆盖模块级 ref，让 renderInline 拿到当前组件实例的 setter。
  // 用 ref 模式而非参数透传，避免给 renderBlock / renderInline / renderListItemText /
  // renderListItems / renderNestedChildren 5 个函数全部加 openFullscreen 参数。
  fullscreenOpenerRef.current = openFullscreen;
  // v3.2.2 P1-14-1：unmount 时把模块级 ref 还原为 noop，避免：
  //   1. 旧实例残留的 setter 干扰新实例（多文档分屏场景）
  //   2. unmount 后被 GC 的函数引用导致内存泄漏
  useEffect(() => {
    return () => {
      fullscreenOpenerRef.current = () => {
        /* noop */
      };
    };
  }, []);
  // v3.2.2 P1-14-2：弹层挂载后 autoFocus，让键盘用户立即按 ESC 可关闭。
  // 不依赖 user-initiated focus（按钮 click 不算），所以需要显式 .focus()。
  useEffect(() => {
    if (fullscreen) fullscreenRef.current?.focus();
  }, [fullscreen]);
  return (
    <>
      <div className={className}>
        {parseMarkdown(content).map((block, index) => renderBlock(block, `block-${index}`))}
      </div>
      {/* v3.2.2 P1-14：图片放大预览。用原生 fixed 遮罩而非 <dialog>，避免与 P2-19 后续统一改造冲突；
          这里只是单实例的轻量弹层（Esc 关闭 + 点遮罩关闭 + 自然 <img> 渲染）。 */}
      {fullscreen && (
        <div
          ref={fullscreenRef}
          role="dialog"
          aria-modal="true"
          aria-label={fullscreen.alt}
          onClick={closeFullscreen}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeFullscreen();
          }}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 outline-none"
        >
          <div
            className="relative flex max-h-full max-w-full flex-col items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 修复 P0-2：图片未就绪时保留骨架占位，避免大弹层黑屏；onError 触发降级 UI。 */}
            {fullscreenStatus !== 'error' && (
              <img
                src={fullscreen.src}
                alt={fullscreen.alt}
                onLoad={handleFullscreenLoad}
                onError={handleFullscreenError}
                className={`max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl ${
                  fullscreenStatus === 'loaded' ? '' : 'opacity-0'
                }`}
              />
            )}
            {fullscreenStatus === 'loading' && (
              // 加载中骨架：保留弹层大小，给用户「正在加载」反馈，避免点开后 1-2s 黑屏
              <div
                aria-hidden="true"
                className="flex max-h-[85vh] min-h-[40vh] min-w-[40vw] max-w-[90vw] items-center justify-center rounded-lg bg-white/10 text-slate-200/80"
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                  <span className="text-sm">正在加载图片…</span>
                </div>
              </div>
            )}
            {fullscreenStatus === 'error' && (
              // 修复 P0-2：图片失效兜底——把 alt、src、可能原因告诉用户，并给出二次排查入口
              // （复制路径 / 重新加载）。避免"我点了图片，弹了个空白"的体验黑洞。
              <div
                role="alert"
                aria-live="polite"
                className="flex max-h-[85vh] min-h-[40vh] min-w-[40vw] max-w-[90vw] flex-col items-center justify-center gap-3 rounded-lg bg-white/95 p-6 text-slate-700 shadow-2xl"
              >
                <div className="text-4xl" aria-hidden="true">🖼️</div>
                <p className="text-base font-semibold text-slate-800">图片加载失败</p>
                <p className="max-w-md text-center text-xs leading-relaxed text-slate-500">
                  文件可能已被删除、移动，或路径不在项目白名单内。
                </p>
                <code
                  className="max-w-md truncate rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-500"
                  title={fullscreen.src}
                >
                  {fullscreen.src}
                </code>
                <p className="text-[11px] text-slate-400">alt: {fullscreen.alt}</p>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      // 强制重新加载：在 URL 末尾追加 ?t= 时间戳绕缓存，让浏览器重新发请求
                      const retrySrc = fullscreen.src + (fullscreen.src.includes('?') ? '&' : '?') + 't=' + Date.now();
                      setFullscreenStatus('loading');
                      setFullscreen({ src: retrySrc, alt: fullscreen.alt });
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100"
                  >
                    🔄 重试
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // 复制 src 到剪贴板，便于用户去项目目录里排查文件
                      void navigator.clipboard?.writeText(fullscreen.src).catch(() => undefined);
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100"
                  >
                    📋 复制路径
                  </button>
                </div>
              </div>
            )}
            <div className="flex w-full items-center justify-between gap-3 text-xs text-slate-200">
              <span className="truncate">{fullscreen.alt}</span>
              <button
                type="button"
                onClick={closeFullscreen}
                className="rounded bg-white/10 px-2 py-1 transition-colors hover:bg-white/20"
                aria-label="关闭预览"
              >
                ✕ 关闭（Esc）
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
