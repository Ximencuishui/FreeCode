/** 预览视图占位（WP-13/14 实现预览服务器与 WebView 后替换） */
export default function PreviewPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-4xl">🔍</p>
        <p className="mt-3 text-sm text-slate-500">预览功能开发中</p>
        <p className="mt-1 text-xs text-slate-400">需求确认并完成开发后，这里会显示您的应用</p>
      </div>
    </div>
  );
}
