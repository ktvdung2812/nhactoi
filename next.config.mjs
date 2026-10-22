/** @type {import('next').NextConfig} */
const lowMemoryBuild = process.env.NHACTOI_LOW_MEMORY_BUILD === "1";
const distDir = process.env.NHACTOI_DIST_DIR || ".next";

const nextConfig = {
  distDir,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] }];
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
