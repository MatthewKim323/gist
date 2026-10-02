// Client-side mirror of lib/server/demo-mode.ts (NEXT_PUBLIC_GIST_DEMO_MODE is inlined at build time).
export const DEMO_MODE = /^(1|true|yes)$/i.test(process.env.NEXT_PUBLIC_GIST_DEMO_MODE?.trim() ?? "");
export const DEMO_VOICE_OFF = "Voice is off in the public demo";

/** True when an API response body is a demo-mode no-op ({demo:true, message}). */
export function isDemoBody(b: unknown): b is { demo: true; message?: string } {
  return typeof b === "object" && b !== null && (b as { demo?: unknown }).demo === true;
}
