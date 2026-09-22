import React from "react";
import ErrorPage from "./ErrorPage.jsx";

export default function AccessDenied({ onBack }) {
  return <ErrorPage code={403} onBack={onBack} />;
}
