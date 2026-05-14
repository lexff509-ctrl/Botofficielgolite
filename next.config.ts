import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence build warnings about server-only packages used by the bot
  serverExternalPackages: ["ws", "pg", "bcryptjs"],
  // Enable instrumentation.ts (auto-migration + bootstrap on startup)
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
