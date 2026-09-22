import React from "react";
import ErrorPage from "./ErrorPage.jsx";
export default class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error("Nhắc tôi: rendering failed", error, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <ErrorPage
          code={500}
          onRetry={() => window.location.reload()}
          onBack={() => window.location.assign("/dashboard")}
        />
      );
    return this.props.children;
  }
}
