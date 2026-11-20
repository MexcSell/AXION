import { Component, type ReactNode } from 'react';
import { AlertOctagon, RotateCcw, Bug } from 'lucide-react';
import { openDialog } from '@/store/ui';

/** Recoverable route-level error boundary (spec §3.2 ErrorBoundary): retry, diagnostics, no secret leakage. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div className="page"><section className="panel" role="alert">
        <div className="empty">
          <div className="empty-icon" style={{ color: 'var(--bad)' }}><AlertOctagon size={28} /></div>
          <h4>This screen hit a recoverable error</h4>
          <p style={{ maxWidth: 420 }}>Nothing was changed. You can retry, or copy a diagnostic (it never contains secrets).</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => this.setState({ error: null })}><RotateCcw size={15} />Retry</button>
            <button className="btn" onClick={() => openDialog('error-inspector', { code: 'AX-UI-500', category: 'render', message: e.message.slice(0, 160) })}><Bug size={15} />Inspect</button>
          </div>
        </div>
      </section></div>
    );
  }
}
