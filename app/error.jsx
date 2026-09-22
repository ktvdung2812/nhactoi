"use client";

import { useEffect } from "react";
import ErrorPage from "../src/ErrorPage.jsx";

export default function Error({ error, reset }) {
  useEffect(() => {
    // Keep the existing diagnostic behavior while letting Next recover the
    // segment through its standard error boundary.
    console.error("Nhắc tôi: rendering failed", error);
  }, [error]);

  return (
    <ErrorPage
      code={500}
      onRetry={reset}
      onBack={() => window.location.assign("/dashboard")}
    />
  );
}
