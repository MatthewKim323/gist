import "server-only";
import { env } from "./env";
import { costOf, logCall, type CallMeta } from "./llm";

// Jev (TypeSafe AI): typed judgments with calibrated probabilities. It never generates text, so it is
// our auditor: does a source support a claim, does a snippet leak strategy, which gate status fits.

export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: "score"; score: number; confidence?: number; probabilities?: Record<string, number> };

export function jevAvailable(): boolean {
  return !!env.typesafeKey();
}

/** One request, many questions over the same state (Jev's batching). State is capped by the API at ~32k tokens. */
export async function jev(
  state: string,
  questions: Record<string, JevQuestion>,
  meta: CallMeta,
): Promise<Record<string, JevAnswer>> {
  const key = env.typesafeKey();
  if (!key) throw new Error("TYPESAFE_API_KEY not set");
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state: state.slice(0, 100_000), questions }),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
      continue;
    }
    if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { model: string; answers: Record<string, JevAnswer>; usage?: { input_tokens: number; output_tokens: number } };
    const input = body.usage?.input_tokens ?? 0;
    const output = body.usage?.output_tokens ?? 0;
    await logCall(body.model ?? "jev-latest", "typesafe", meta, {
      input, output, cached: 0, cost: costOf("jev-latest", input, 0), latencyMs: Date.now() - t0,
    });
    return body.answers;
  }
}
