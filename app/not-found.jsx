"use client";

import { useRouter } from "next/navigation";
import ErrorPage from "../src/ErrorPage.jsx";

export default function NotFound() {
  const router = useRouter();
  return <ErrorPage code={404} onBack={() => router.push("/dashboard")} />;
}
