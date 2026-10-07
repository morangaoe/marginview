import { Component, ErrorInfo, ReactNode } from "react";
import { reportClientError } from "../lib/errorReporter";

/** Catches render crashes, reports them, and shows a recoverable message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError({
      kind: "render",
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 16 }}>
        <div className="card" style={{ maxWidth: 420, textAlign: "center" }}>
          <strong style={{ display: "block", marginBottom: 8 }}>Something went wrong on this page</strong>
          <p style={{ color: "var(--slate)", fontSize: 13, margin: "0 0 16px" }}>
            The problem has been reported. Reload to try again.
          </p>
          <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
