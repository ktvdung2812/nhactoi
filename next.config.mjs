/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["nhactoi.test"],
  serverExternalPackages: ["express", "nodemailer", "google-auth-library", "@aws-sdk/client-s3"],
  // Runtime data and credentials are mounted separately, never build assets.
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./demo/**/*", "./mobile/**/*", "./artifacts/**/*", "./.env*", "./*.tar.gz"],
  },
};

export default nextConfig;
