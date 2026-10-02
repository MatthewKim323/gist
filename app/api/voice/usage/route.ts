// Logs a finished realtime voice session into llm_calls (purpose "voice") with a rough cost.
// Token counts come from the Realtime API's response.done usage, summed in the browser; clamped here.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

// Rough gpt-realtime-mini audio rates, USD per 1M tokens (text is cheaper, so this overestimates).
const RATE_IN = 10;
const RATE_OUT = 20;
const RATE_CACHED = 0.3;

const n = (v: unknown, max = 2_000_000) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = n(b.input_tokens);
  const output = n(b.output_tokens);
  const cached = Math.min(input, n(b.cached_tokens));
  if (!input && !output) return NextResponse.json({ ok: true, logged: false });
  const model = typeof b.model === "string" && /^[\w.-]{1,60}$/.test(b.model) ? b.model : "realtime";
  const matterId = n(b.matterId, Number.MAX_SAFE_INTEGER) || null;
  const cost = ((input - cached) * RATE_IN + cached * RATE_CACHED + output * RATE_OUT) / 1e6;
  await db()
    .from("llm_calls")
    .insert({
      matter_id: matterId,
      purpose: "voice",
      provider: "openai",
      model,
      input_tokens: input,
      output_tokens: output,
      cached_tokens: cached,
      cost_usd: Number(cost.toFixed(6)),
      latency_ms: n(b.duration_ms, 3_600_000),
    })
    .then(
      () => null,
      () => null,
    );
  return NextResponse.json({ ok: true, logged: true });
}
