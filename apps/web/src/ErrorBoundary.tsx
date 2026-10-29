import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Last line of defence: a render error in one screen should not leave a blank
 * white page. Shows what broke, keeps the message readable, and offers a reload
 * plus a "start over" escape hatch for a corrupted local session.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Unhandled UI error", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private resetSession = () => {
    localStorage.removeItem("jmit.token");
    localStorage.removeItem("jmit.workspace");
    window.location.hash = "#/";
    window.location.reload();
  };

  render() {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="boot">
        <div className="card crash">
          <h1>Something broke on this screen</h1>
          <p>
            Your data is safe on the server. Reloading usually fixes it; if it keeps happening,
            start a fresh session below.
          </p>
          <pre className="crash__detail">{error.message}</pre>
          <div className="crash__actions">
            <button type="button" className="btn btn--primary" onClick={this.reload}>
              Reload the app
            </button>
            <button type="button" className="btn" onClick={this.resetSession}>
              Sign out and reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
