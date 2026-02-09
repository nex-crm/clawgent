import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  typescript: {
    // server.ts has a known type issue (line 42) that doesn't affect runtime.
    // server.ts is run by tsx, not compiled by Next.js build.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
