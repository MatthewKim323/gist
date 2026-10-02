"use client";

import { DEMO_MODE } from "@/lib/demo-mode-client";

/** Slim strip shown on firm pages when the deployment runs in public demo mode. Renders nothing otherwise. */
export default function DemoBanner({ className }: { className?: string }) {
  if (!DEMO_MODE) return null;
  return (
    <div
      className={className}
      role="note"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        margin: "0 0 14px",
        padding: "6px 12px",
        borderRadius: 999,
        border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
        background: "color-mix(in srgb, currentColor 4%, transparent)",
        fontSize: 12,
        lineHeight: 1.4,
        letterSpacing: "0.01em",
        textAlign: "center",
        opacity: 0.85,
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: "#d9822b", flex: "none" }} />
      <span>Public demo · read-only snapshot of a live Clio case · no AI spend</span>
    </div>
  );
}
