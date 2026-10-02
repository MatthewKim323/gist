import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  agentRules: false,
  // dev is served on 127.0.0.1 (Clio OAuth rejects localhost redirects), so allow it as a dev origin.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // pdf rendering for the OCR stage runs server-side with native canvas; keep it out of the bundle.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/pdfjs-dist/wasm/**", "./node_modules/pdfjs-dist/legacy/build/**"],
  },
};

export default nextConfig;
