import React, { type ReactNode } from "react";
import { recordExternalAppError } from "./errorRecords";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    recordExternalAppError({
      title: "Application Render Error",
      source: "frontend.render",
      error,
      message: info.componentStack?.trim()
        ? `${error.message}\n${info.componentStack.trim()}`
        : error.message,
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-section">
          <section className="panel empty-state">
            <div>
              <h1>Application error</h1>
              <p className="muted">
                The app hit an unexpected render error. Reload to recover, then check Task Center.
              </p>
            </div>
            <div className="button-row">
              <button onClick={this.handleReload}>Reload App</button>
            </div>
          </section>
        </div>
      );
    }
    return this.props.children;
  }
}
