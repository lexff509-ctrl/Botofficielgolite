import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Render.com deployment (non-Vercel)
  output: "standalone",
  // Silence build warnings about server-only packages (ws, node crypto, etc.)
  serverExternalPackages: ["ws", "pg", "bcryptjs"],
};

export default nextConfig;
