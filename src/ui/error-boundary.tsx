import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Rendered instead of the children after they throw; gets a retry that remounts them. */
  fallback?: (error: unknown, retry: () => void) => ReactNode;
  children: ReactNode;
}

/** React only catches render errors in class components; this keeps one broken panel from blanking the window. */
export class ErrorBoundary extends Component<Props, { error: unknown; failed: boolean }> {
  override state = { error: undefined as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  retry = () => this.setState({ error: undefined, failed: false });

  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.retry);
    return <PanelError error={this.state.error} retry={this.retry} />;
  }
}

export function PanelError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1 truncate text-bad" title={String(error)} data-selectable>
        {error instanceof Error ? error.message : String(error)}
      </span>
      <button type="button" onClick={retry} className="shrink-0 text-muted hover:text-fg">
        Retry
      </button>
    </div>
  );
}
