import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence build warnings about server-only packages used by the bot
  serverExternalPackages: ["ws", "pg", "bcryptjs"],
  // instrumentation.ts runs automatically in Next.js 16+ (no config needed)
};

export default nextConfig;
