import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "./env";
import { db } from "./db";
import { assertNotDemo } from "./demo-mode";

let client: OpenAI | null = null;
export function openai(): OpenAI {
  assertNotDemo("the OpenAI client");
  if (!client) client = new OpenAI({ apiKey: env.openaiKey(), maxRetries: 4 });
  return client;
}

// USD per 1M tokens. Keep in code so every logged call has a real cost. Unknown models log $0.
const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  "gpt-5.5": { in: 1.25, cached: 0.125, out: 10 },
  "gpt-5.4-mini": { in: 0.25, cached: 0.025, out: 2 },
  "gpt-5.4-nano": { in: 0.05, cached: 0.005, out: 0.4 },
  "text-embedding-3-large": { in: 0.13, cached: 0, out: 0 },
  "jev-latest": { in: 0.042, cached: 0, out: 0 },
};

export function costOf(model: string, input: number, output: number, cached = 0): number {
  const p = PRICES[model] ?? PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  if (!p) return 0;
  return ((input - cached) * p.in + cached * p.cached + output * p.out) / 1e6;
}

export interface CallMeta {
  purpose: string;
  matterId?: number | null;
  runId?: string | null;
}

export interface Usage { input: number; output: number; cached: number; cost: number; latencyMs: number }

export async function logCall(model: string, provider: string, meta: CallMeta, u: Usage) {
  await db().from("llm_calls").insert({
    matter_id: meta.matterId ?? null, run_id: meta.runId ?? null, purpose: meta.purpose,
    provider, model, input_tokens: u.input, output_tokens: u.output, cached_tokens: u.cached,
    cost_usd: u.cost, latency_ms: u.latencyMs,
  });
}

/**
 * Structured output call (OpenAI Responses API). Returns parsed object + usage, and logs the call.
 * `input` may be a string or Responses API input items (for images: {type:'input_image', image_url}).
 */
export async function structured<T extends z.ZodTypeAny>(opts: {
  model?: string;
  system: string;
  input: OpenAI.Responses.ResponseInput | string;
  schema: T;
  schemaName: string;
  meta: CallMeta;
  reasoning?: "minimal" | "low" | "medium" | "high";
}): Promise<{ data: z.infer<T>; usage: Usage }> {
  assertNotDemo(`model calls (${opts.meta.purpose})`);
  const model = opts.model ?? env.swarmModel();
  const t0 = Date.now();
  const res = await openai().responses.parse({
    model,
    instructions: opts.system,
    input: opts.input,
    text: { format: zodTextFormat(opts.schema, opts.schemaName) },
    ...(opts.reasoning ? { reasoning: { effort: opts.reasoning } } : {}),
  });
  const input = res.usage?.input_tokens ?? 0;
  const output = res.usage?.output_tokens ?? 0;
  const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
  const usage: Usage = { input, output, cached, cost: costOf(model, input, output, cached), latencyMs: Date.now() - t0 };
  await logCall(model, "openai", opts.meta, usage);
  if (!res.output_parsed) throw new Error(`${opts.schemaName}: no parsed output`);
  return { data: res.output_parsed as z.infer<T>, usage };
}

/** Embeddings as pgvector text literals ('[0.1,...]'), batched. */
export async function embed(texts: string[], meta: CallMeta): Promise<string[]> {
  assertNotDemo(`embeddings (${meta.purpose})`);
  const model = env.embeddingModel();
  const out: string[] = [];
  for (let i = 0; i < texts.length; i += 256) {
    const batch = texts.slice(i, i + 256).map((t) => t.slice(0, 24000));
    const t0 = Date.now();
    const r = await openai().embeddings.create({ model, input: batch, dimensions: env.embeddingDims() });
    const input = r.usage?.prompt_tokens ?? 0;
    await logCall(model, "openai", meta, { input, output: 0, cached: 0, cost: costOf(model, input, 0), latencyMs: Date.now() - t0 });
    for (const d of r.data) out.push(`[${d.embedding.join(",")}]`);
  }
  return out;
}
