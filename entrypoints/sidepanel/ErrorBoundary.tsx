import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

const MAX_RETRIES = 3;

function i18n(key: string): string {
  return chrome.i18n.getMessage(key) || key;
}

/**
 * React Error Boundary that catches rendering errors (including lazy-load
 * failures and minifier-induced ReferenceError) and displays a recoverable
 * fallback UI instead of crashing the entire sidepanel.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught rendering error:', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    // 在这里递增 retryCount，因为 getDerivedStateFromError 无法访问 prevState
    this.setState(prev => ({ retryCount: prev.retryCount + 1 }));
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, retryCount: 0 });
  };

  handleFullReload = () => {
    location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const err = this.state.error;
      const errorType = err?.constructor?.name ?? 'Error';
      const message = err?.message ?? i18n('errors_boundary_unknownError');
      const stackLines = err?.stack?.split('\n').slice(1, 4).join('\n') ?? '';
      const canRetry = this.state.retryCount < MAX_RETRIES;

      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', padding: 20,
          fontFamily: 'system-ui', overflow: 'auto',
        }}>
          <div style={{ maxWidth: 520, textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 18, color: '#dc2626' }}>
              {i18n('errors_boundary_title')}
            </h2>
            <p style={{ margin: '0 0 8px', color: '#666', lineHeight: 1.6 }}>
              <code style={{
                background: '#fef2f2', padding: '2px 6px',
                borderRadius: 3, fontSize: 13, color: '#dc2626',
              }}>
                {errorType}: {message}
              </code>
            </p>
            {stackLines && (
              <pre style={{
                margin: '0 0 12px', padding: 8, background: '#f8f9fa',
                borderRadius: 6, fontSize: 11, textAlign: 'left',
                overflowX: 'auto', maxHeight: 120, color: '#555',
              }}>
                {stackLines}
              </pre>
            )}
            {!canRetry && (
              <p style={{ margin: '0 0 8px', color: '#888', fontSize: 13 }}>
                {i18n('errors_boundary_retryLimit')}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {canRetry && (
                <button
                  onClick={this.handleReload}
                  style={{
                    padding: '8px 20px', background: '#2563eb', color: '#fff',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
                  }}
                >
                  {i18n('errors_boundary_retry')}
                </button>
              )}
              <button
                onClick={this.handleFullReload}
                style={{
                  padding: '8px 16px', background: '#f3f4f6', color: '#666',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}
              >
                {i18n('errors_boundary_reload')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
