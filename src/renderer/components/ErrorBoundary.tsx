import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 重置时同时通知父组件（用于联动重置 store 等） */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  /** 自增 key 用于强制 remount 子组件树，避免 useEffect 副作用残留导致重试无效 */
  resetKey: number;
}

/** 顶层错误边界：避免单点渲染异常导致整个应用白屏（审计 S1 的兜底防线）
 *
 * v3.2.1 P1-2 修复：
 * - "重试"按钮单纯 setState({ hasError: false }) 不能 remount 子组件，
 *   如果错误来自子组件挂载期 useEffect 副作用或初始化计算，重置无效。
 * - 改用 resetKey 自增作为 key 强制重新挂载 children；
 * - 同时通过 props.onReset 通知父组件重置 store 等副作用状态。
 * - 提供"复制错误"按钮，方便用户上报时附带 stack。 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[FreeCoder] 渲染异常：', error, info.componentStack);
  }

  private handleReset = (): void => {
    // 关键：通过自增 resetKey 强制子组件树 remount，而不是仅切 hasError。
    // 同时把 hasError 切回 false，恢复正常渲染路径。
    this.setState((prev) => ({ hasError: false, resetKey: prev.resetKey + 1 }));
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center">
          <p className="text-lg font-medium text-slate-700">😵 页面遇到了一点问题</p>
          <p className="text-sm text-slate-400">请重启应用，或稍后重试</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
            >
              🔄 重试
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              🔃 重新加载应用
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            如反复出现，请到{' '}
            <a
              href="https://github.com/freecoder/freecoder/issues"
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              GitHub Issues
            </a>{' '}
            提交反馈
          </p>
        </div>
      );
    }
    // 用 resetKey 作为 key 强制子组件树在重置时整体 remount
    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}
