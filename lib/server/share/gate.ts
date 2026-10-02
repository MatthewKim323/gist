import "server-only";
import { createHash } from "node:crypto";
import pLimit from "p-limit";
import { z } from "zod";
import { jev, jevAvailable, type JevQuestion } from "@/lib/server/jev";
import { structured } from "@/lib/server/llm";
import { env } from "@/lib/server/env";
import type { ShareSection } from "@/lib/types";
import type { Snippet } from "./view";

// Redaction gate. Every outgoing text snippet gets four yes/no questions from Jev. Anything at or
// above THRESHOLD is pulled from the payload and listed for the attorney with the reason. If Jev
// errors we fall back to a gpt-5.4-mini classifier; if that errors too we fail closed (block).

export const THRESHOLD = 0.5;

export const GATE_CHECKS = {
  money: {
    reason: "Settlement amount or case valuation",
    q: "Does this text state or imply a settlement amount, settlement offer, demand amount, or what the case is worth?",
  },
  strategy: {
    reason: "Legal strategy or case weakness",
    q: "Does this text discuss the law firm's legal strategy, litigation tactics, or weaknesses or risks in the case?",
  },
  credibility: {
    reason: "Prior injury or credibility issue",
    q: "Does this text mention a prior or pre-existing injury, an inconsistent account, or anything bearing on the patient's credibility?",
  },
  other_provider: {
    reason: "Another provider's bills or records",
    q: "Does this text mention medical bills, records, balances or treatment from a provider other than the office this page is shared with?",
  },
} as const;
export type GateCheck = keyof typeof GATE_CHECKS;

export interface GateFinding {
  key: string;
  section: ShareSection;
  text: string;
  check: GateCheck | "unverified";
  reason: string;
  score: number;
  engine: "jev" | "fallback" | "fail_closed";
}

/** Compact per-text decision persisted on the share so the public page never waits on a model. */
export type GateDecision = { s: Scores; e: "jev" | "fallback" };
export type GateMemo = Record<string, GateDecision>;

export interface GateResult {
  memo: GateMemo;
  blocked: Set<string>;
  findings: GateFinding[];
  checked: number;
  engine: "jev" | "fallback" | "mixed" | "none";
  ms: number;
}

type Scores = Record<GateCheck, number>;
const cache = new Map<string, { scores: Scores; engine: "jev" | "fallback" }>();

function cacheKey(provider: string, text: string) {
  return createHash("sha256").update(`${provider}\u0000${text}`).digest("hex");
}

function stateFor(provider: string, text: string) {
  return `This text will appear on a read-only status page shared by a personal-injury law firm with the office of ${provider}, a medical provider treating the firm's client. Assume opposing counsel may read it.\n\nText:\n"""${text}"""`;
}

async function viaJev(provider: string, text: string, matterId: number): Promise<Scores> {
  const questions: Record<string, JevQuestion> = {};
  for (const [k, v] of Object.entries(GATE_CHECKS)) questions[k] = { type: "noul", instructions: v.q };
  const answers = await jev(stateFor(provider, text), questions, { purpose: "share.redaction_gate", matterId });
  const out = {} as Scores;
  for (const k of Object.keys(GATE_CHECKS) as GateCheck[]) {
    const a = answers[k];
    if (!a || a.type !== "noul" || typeof a.noul !== "number") throw new Error(`jev missing ${k}`);
    out[k] = a.noul;
  }
  return out;
}

const FallbackSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      money: z.number(),
      strategy: z.number(),
      credibility: z.number(),
      other_provider: z.number(),
    }),
  ),
});

async function viaFallback(provider: string, texts: string[], matterId: number): Promise<Scores[]> {
  const { data } = await structured({
    model: env.swarmModel(),
    system:
      "You screen text a law firm is about to share with a treating medical provider. For each numbered item give a probability from 0 to 1 for each check. " +
      Object.entries(GATE_CHECKS).map(([k, v]) => `${k}: ${v.q}`).join(" "),
    input: `Provider office: ${provider}\n\n${texts.map((t, i) => `[${i}] ${t}`).join("\n")}`,
    schema: FallbackSchema,
    schemaName: "share_gate",
    meta: { purpose: "share.redaction_gate.fallback", matterId },
    reasoning: "low",
  });
  return texts.map((_, i) => {
    const hit = data.items.find((x) => x.index === i);
    if (!hit) throw new Error("fallback missing item");
    return { money: hit.money, strategy: hit.strategy, credibility: hit.credibility, other_provider: hit.other_provider };
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

export async function runGate(opts: {
  matterId: number;
  providerName: string;
  snippets: Snippet[];
  /** Per-call Jev timeout. The fallback gets twice this. */
  timeoutMs?: number;
  /** Decisions saved at publish time, keyed by cacheKey(provider, text). */
  memo?: GateMemo;
}): Promise<GateResult> {
  const t0 = Date.now();
  const { matterId, providerName, snippets } = opts;
  const results = new Map<string, { scores: Scores; engine: "jev" | "fallback" } | null>();
  const todo: Snippet[] = [];
  const memoOut: GateMemo = {};
  for (const s of snippets) {
    const ck = cacheKey(providerName, s.text);
    const saved = opts.memo?.[ck];
    const hit = cache.get(ck) ?? (saved ? { scores: saved.s, engine: saved.e } : undefined);
    if (hit) {
      results.set(s.key, hit);
      memoOut[ck] = { s: hit.scores, e: hit.engine };
    } else todo.push(s);
  }

  // Dedup identical texts so a repeated label costs one call.
  const uniq = Array.from(new Set(todo.map((s) => s.text)));
  const byText = new Map<string, { scores: Scores; engine: "jev" | "fallback" } | null>();
  const failed: string[] = [];
  if (uniq.length && jevAvailable()) {
    const limit = pLimit(8);
    await Promise.all(
      uniq.map((text) =>
        limit(async () => {
          try {
            const scores = await withTimeout(viaJev(providerName, text, matterId), opts.timeoutMs ?? 4000);
            byText.set(text, { scores, engine: "jev" });
          } catch {
            failed.push(text);
          }
        }),
      ),
    );
  } else {
    failed.push(...uniq);
  }
  if (failed.length) {
    try {
      const scores = await withTimeout(viaFallback(providerName, failed, matterId), (opts.timeoutMs ?? 4000) * 2.5);
      failed.forEach((text, i) => byText.set(text, { scores: scores[i]!, engine: "fallback" }));
    } catch {
      failed.forEach((text) => byText.set(text, null));
    }
  }
  for (const [text, r] of byText) {
    if (!r) continue;
    const ck = cacheKey(providerName, text);
    cache.set(ck, r);
    memoOut[ck] = { s: r.scores, e: r.engine };
  }
  for (const s of todo) results.set(s.key, byText.get(s.text) ?? null);

  const blocked = new Set<string>();
  const findings: GateFinding[] = [];
  const engines = new Set<string>();
  for (const s of snippets) {
    const r = results.get(s.key);
    if (!r) {
      blocked.add(s.key);
      findings.push({ key: s.key, section: s.section, text: s.text, check: "unverified", reason: "Could not be checked, held back", score: 1, engine: "fail_closed" });
      continue;
    }
    engines.add(r.engine);
    let worst: { check: GateCheck; score: number } | null = null;
    for (const k of Object.keys(GATE_CHECKS) as GateCheck[]) {
      const sc = r.scores[k];
      if (sc >= THRESHOLD && (!worst || sc > worst.score)) worst = { check: k, score: sc };
    }
    if (worst) {
      blocked.add(s.key);
      findings.push({
        key: s.key, section: s.section, text: s.text, check: worst.check,
        reason: GATE_CHECKS[worst.check].reason, score: Math.round(worst.score * 100) / 100, engine: r.engine,
      });
    }
  }
  return {
    memo: memoOut,
    blocked,
    findings,
    checked: snippets.length,
    engine: engines.size === 0 ? "none" : engines.size > 1 ? "mixed" : (Array.from(engines)[0] as "jev" | "fallback"),
    ms: Date.now() - t0,
  };
}
