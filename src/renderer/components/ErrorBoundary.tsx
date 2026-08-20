import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** 顶层错误边界：避免单点渲染异常导致整个应用白屏（审计 S1 的兜底防线） */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[FreeCoder] 渲染异常：', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center">
          <p className="text-lg font-medium text-slate-700">😵 页面遇到了一点问题</p>
          <p className="text-sm text-slate-400">请重启应用，或稍后重试</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
