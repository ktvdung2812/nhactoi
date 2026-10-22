/** @type {import('next').NextConfig} */
const lowMemoryBuild = process.env.NHACTOI_LOW_MEMORY_BUILD === "1";
const distDir = process.env.NHACTOI_DIST_DIR || ".next";
// TODO: add script-src once the inline theme script in app/layout.jsx uses a
// nonce; Next dev also needs 'unsafe-eval'.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

const nextConfig = {
  distDir,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
  allowedDevOrigins: ["nhactoi.test"],
  serverExternalPackages: ["pg", "synckit", "express", "nodemailer", "google-auth-library", "web-push", "@aws-sdk/client-s3", "mammoth", "exceljs", "html-to-text"],
  ...(lowMemoryBuild
    ? {
        experimental: {
          cpus: 1,
          webpackMemoryOptimizations: true,
        },
      }
    : {}),
  // Runtime data and credentials are mounted separately, never build assets.
  outputFileTracingIncludes: { "/*": ["./server/postgres-worker.mjs", "./server/migrations/postgres/*.sql"] },
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./demo/**/*", "./mobile/**/*", "./artifacts/**/*", "./.env*", "./*.tar.gz"],
  },
};

export default nextConfig;
