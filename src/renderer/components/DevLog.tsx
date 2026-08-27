/** 开发日志展示（"开发团队怎么说"）：以 [开发员] 前缀呈现工具调用与执行结果 */
export default function DevLog({ lines }: { lines: string[] }) {
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
    <div className="max-h-80 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-500">
      {lines.map((l, i) => (
        <div key={i} className="break-words">
          [开发员] {l}
        </div>
      ))}
    </div>
  );
}
