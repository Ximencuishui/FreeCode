/** 开发日志展示（"开发团队怎么说"）：以 [开发员] 前缀呈现工具调用与执行结果。
 * 修复 P1-5：上方添加搜索框，按关键字模糊过滤 [开发员] 行。空 query 时显示全部。
 * 搜索框 + 结果数实时刷新，过滤逻辑走 useMemo 避免每帧重算。 */
import { useMemo, useState } from 'react';

export default function DevLog({ lines }: { lines: string[] }) {
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim().toLowerCase();

  // 模糊匹配：行内容中包含小写化的关键字。不区分大小写；空 query 返回原始列表。
  const filtered = useMemo(() => {
    if (!trimmedQuery) return lines;
    return lines.filter((l) => l.toLowerCase().includes(trimmedQuery));
  }, [lines, trimmedQuery]);

  if (lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
        💡 暂无开发记录
        <br />
        <span className="mt-1 block">开发完成后，这里会显示 AI 开发团队的原始过程</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {/* 搜索栏：右键清空时不影响其他视图。查询结果数与命中/总数都展示出来，避免
          「过滤了但看上去一样」的认知障碍。 */}
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索开发记录…"
          aria-label="搜索开发日志"
          data-testid="fc-devlog-search-input"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="清除搜索"
            className="text-slate-400 transition-colors hover:text-slate-700"
          >
            ✕
          </button>
        )}
      </div>
      <p
        className="text-[10px] text-slate-400"
        aria-live="polite"
        data-testid="fc-devlog-result-count"
      >
        {trimmedQuery
          ? `匹配 ${filtered.length} / 共 ${lines.length} 条`
          : `共 ${lines.length} 条`}
      </p>
      <div
        className="max-h-80 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md border border-slate-100 bg-slate-50/50 p-2 font-mono text-[11px] leading-relaxed text-slate-500"
        data-testid="fc-devlog-list"
      >
        {filtered.length === 0 ? (
          <div className="py-4 text-center text-slate-400">没有匹配「{query}」的记录</div>
        ) : (
          filtered.map((l, i) => (
            <div key={i} className="break-words">
              [开发员] {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
