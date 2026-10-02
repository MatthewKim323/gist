// Public demo mode. When GIST_DEMO_MODE=1 the deployment is a read-only snapshot: no Clio calls and no
// model spend. The guards live at the choke points (llm.ts, jev.ts, clio/client.ts) so nothing slips
// through even if a route forgets to check.

export function isDemoMode(): boolean {
  const v = process.env.GIST_DEMO_MODE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export class DemoModeError extends Error {
  readonly demo = true;
  constructor(what: string) {
    super(`Demo mode: ${what} is disabled on the public demo`);
    this.name = "DemoModeError";
  }
}

export function assertNotDemo(what: string): void {
  if (isDemoMode()) throw new DemoModeError(what);
}

export function isDemoModeError(e: unknown): e is DemoModeError {
  return e instanceof DemoModeError || (typeof e === "object" && e !== null && (e as { demo?: unknown }).demo === true);
}

export const DEMO_SYNC_MESSAGE = "Demo mode: live Clio sync is off on the public demo";
export const DEMO_AI_LINE = "Demo mode: answers come from the case data, not a live model.";

/** Standard 200 body for routes that would have done live work. */
export function demoBody(message = DEMO_SYNC_MESSAGE, extra: Record<string, unknown> = {}) {
  return { demo: true, message, ...extra };
}
