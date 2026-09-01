import type { ReactNode } from 'react';

interface DocumentMarkdownProps {
  content: string;
  className?: string;
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'rule' };

const INLINE_TOKEN = /(\x60[^\x60]+\x60|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|\*[^*]+\*|_[^_]+_)/g;

function isBlank(line: string): boolean {
  return !line.trim();
}

function isRawHtml(line: string): boolean {
  return /^<\/?[A-Za-z][^>]*>$/.test(line.trim());
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
      const items: string[] = [];
      const itemPattern = unordered ? /^\s{0,3}[-*+]\s+/ : /^\s{0,3}\d+\.\s+/;
      while (index < lines.length) {
        const item = lines[index].match(itemPattern);
        if (!item) break;
        items.push(lines[index].slice(item[0].length));
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
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
      const image = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      nodes.push(
        <span key={key} className="rounded bg-slate-100 px-1 text-xs text-slate-500">
          🖼 {image?.[1] || '图片'}
        </span>,
      );
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
            <span key={key} className="text-slate-500 underline decoration-dotted">
              {label}
            </span>
          ),
        );
      } else {
        nodes.push(token);
      }
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function renderListItem(item: string, key: string) {
  const task = item.match(/^\[([ xX])\]\s+(.*)$/);
  if (!task) return <span>{renderInline(item, key)}</span>;
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
      return block.ordered ? (
        <ol key={key} className="my-3 list-decimal space-y-1.5 pl-6 text-sm text-slate-700">
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>{renderListItem(item, `${key}-${index}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="my-3 list-disc space-y-1.5 pl-6 text-sm text-slate-700">
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`} className="pl-1 marker:text-slate-400">
              {renderListItem(item, `${key}-${index}`)}
            </li>
          ))}
        </ul>
      );
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
  return <div className={className}>{parseMarkdown(content).map((block, index) => renderBlock(block, `block-${index}`))}</div>;
}
