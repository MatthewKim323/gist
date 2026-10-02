import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  agentRules: false,
  // pdf rendering for the OCR stage runs server-side with native canvas; keep it out of the bundle.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/pdfjs-dist/wasm/**", "./node_modules/pdfjs-dist/legacy/build/**"],
  },
};

export default nextConfig;
