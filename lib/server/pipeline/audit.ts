import "server-only";
import pLimit from "p-limit";
import { db } from "../db";
import { costOf } from "../llm";
import { jev, jevAvailable, type JevAnswer, type JevQuestion } from "../jev";
import type { RunCtx } from "./ctx";

// Jev audit: the quote is in the source (verify.ts checked that), but does the source actually back the
// summary the extractor wrote on top of it? One Choice question per fact, many facts per request,
// with every cited source in the state.

export interface AuditInput {
  id: string;
  source_ref: string;
  claim: string;
  quote: string;
  /** Status after the deterministic verifier: pending (clean) or needs_review (date/amount not in quote). */
  status: "pending" | "needs_review";
  sourceText: string;
}

const AUTO_ACCEPT = 0.8;
// Jev reads best with one source in view: pack only small sources together (well under the ~32k token cap).
const MAX_STATE_CHARS = 12_000;
const MAX_SOURCE_CHARS = 40_000;
const MAX_QUESTIONS = 40;

const CRITERIA = {
  supports: "The cited source states the claim or directly implies that it is true",
  contradicts: "The cited source states the opposite of the claim or implies it is false",
  unsupported: "The cited source does not address what the claim asserts, or the claim goes beyond what it says",
};

interface Batch { sources: Map<string, string>; facts: AuditInput[]; chars: number }

function batches(facts: AuditInput[]): Batch[] {
  const bySource = new Map<string, AuditInput[]>();
  for (const f of facts) {
    const arr = bySource.get(f.source_ref) ?? [];
    arr.push(f);
    bySource.set(f.source_ref, arr);
  }
  const out: Batch[] = [];
  let cur: Batch = { sources: new Map(), facts: [], chars: 0 };
  for (const [ref, fs] of bySource) {
    const text = fs[0].sourceText.slice(0, MAX_SOURCE_CHARS);
    for (let i = 0; i < fs.length; i += MAX_QUESTIONS) {
      const part = fs.slice(i, i + MAX_QUESTIONS);
      const add = cur.sources.has(ref) ? 0 : text.length;
      if (cur.facts.length && (cur.chars + add > MAX_STATE_CHARS || cur.facts.length + part.length > MAX_QUESTIONS)) {
        out.push(cur);
        cur = { sources: new Map(), facts: [], chars: 0 };
      }
      if (!cur.sources.has(ref)) { cur.sources.set(ref, text); cur.chars += text.length; }
      cur.facts.push(...part);
    }
  }
  if (cur.facts.length) out.push(cur);
  return out;
}

function supportProb(a: JevAnswer | undefined): { choice: "supports" | "contradicts" | "unsupported" | null; p: number | null } {
  if (!a || a.type !== "choice") return { choice: null, p: null };
  const choice = (["supports", "contradicts", "unsupported"].includes(a.choice) ? a.choice : "unsupported") as "supports" | "contradicts" | "unsupported";
  const p = a.probabilities?.supports ?? (choice === "supports" ? a.confidence ?? null : a.confidence != null ? 1 - a.confidence : null);
  return { choice, p };
}

async function writeResults(rows: { id: string; patch: Record<string, unknown> }[]) {
  const limit = pLimit(10);
  await Promise.all(rows.map((r) => limit(() => db().from("facts").update(r.patch).eq("id", r.id))));
}

/** Fallback when Jev is unavailable or errors: the quote check alone stands. */
function quoteOnly(f: AuditInput) {
  return { id: f.id, patch: { status: f.status === "pending" ? "verified" : "needs_review", jev_support: null, jev_confidence: null } };
}

/** Returns estimated Jev cost. Never throws: a Jev outage downgrades to quote-verified facts. */
export async function auditFacts(ctx: RunCtx, facts: AuditInput[]): Promise<number> {
  if (!facts.length) return 0;
  if (!jevAvailable()) {
    await writeResults(facts.map(quoteOnly));
    return 0;
  }
  const limit = pLimit(10);
  let total = 0;
  await Promise.all(batches(facts).map((b) => limit(async () => {
    try {
      await ctx.task("jev", `audit ${b.facts.length} facts`, async (t) => {
        const state = JSON.stringify({ sources: Object.fromEntries(b.sources) });
        const questions: Record<string, JevQuestion> = {};
        b.facts.forEach((f, i) => {
          questions[`f${i}`] = {
            type: "choice",
            instructions: `Read only sources["${f.source_ref}"] in the state. The quoted span is: "${f.quote.slice(0, 300)}". Claim: "${f.claim}". How does that cited source relate to the claim?`,
            criteria: CRITERIA,
          };
        });
        const answers = await jev(state, questions, { purpose: "audit", matterId: ctx.matterId, runId: ctx.runId });
        const estIn = Math.round((state.length + JSON.stringify(questions).length) / 4);
        const cost = costOf("jev-latest", estIn, 0);
        t.usage({ input: estIn, cost });
        total += cost;
        let ok = 0;
        const rows = b.facts.map((f, i) => {
          const { choice, p } = supportProb(answers[`f${i}`]);
          if (!choice) return quoteOnly(f);
          const pass = choice === "supports" && (p ?? 0) >= AUTO_ACCEPT;
          if (pass && f.status === "pending") ok++;
          return {
            id: f.id,
            patch: {
              jev_support: choice,
              jev_confidence: p,
              status: pass && f.status === "pending" ? "verified" : "needs_review",
              ...(pass ? {} : { reject_reason: f.status === "needs_review" ? undefined : `jev: ${choice} (${(p ?? 0).toFixed(2)})` }),
            },
          };
        });
        await writeResults(rows);
        t.facts(ok);
        await t.event(`${ok}/${b.facts.length} supported`);
      });
    } catch {
      await writeResults(b.facts.map(quoteOnly));
    }
  })));
  return total;
}
