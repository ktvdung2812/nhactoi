"use client";

import { WebAppBootstrap } from "../src/WebPushSettings.jsx";
import dynamic from "next/dynamic";
import { Bell } from "lucide-react";
import { usePathname } from "next/navigation";
import ErrorBoundary from "../src/ErrorBoundary.jsx";
import { isValidRoute } from "../src/routes.js";

const LegacyApp = dynamic(() => import("../src/App.jsx"), {
  ssr: false,
  loading: () => (
    <div className="loading-screen" aria-live="polite">
      <span className="brand-mark" aria-hidden="true">
        <Bell />
      </span>
      Đang mở không gian làm việc…
    </div>
  ),
});

export default function ClientApp({ children }) {
  const pathname = usePathname();
  const validRoute = isValidRoute(pathname);

  return (
    <>
      <WebAppBootstrap />
      {validRoute && (
        <ErrorBoundary>
          <LegacyApp />
        </ErrorBoundary>
      )}
      {children}
    </>
  );
}
