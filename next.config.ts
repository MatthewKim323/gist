import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  agentRules: false,
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
