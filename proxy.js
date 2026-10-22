import { NextResponse } from "next/server";
import { pageCsp } from "./shared/content-security-policy.mjs";

// Next reads the nonce from the request CSP and adds it to its own scripts;
// app/layout.jsx reads x-nonce for the inline theme script.
export function proxy(request) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = pageCsp(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
