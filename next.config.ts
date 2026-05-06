import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence build warnings about server-only packages used by the bot
  serverExternalPackages: ["ws", "pg", "bcryptjs"],
};

export default nextConfig;
