import "server-only";
import pLimit from "p-limit";
import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { structured } from "../llm";
import { jev, jevAvailable } from "../jev";
import type { RunCtx } from "../pipeline/ctx";
import type { Citation, Fact, GateItem, GateStatus, Owner, Phase } from "@/lib/types";
import { computeSignals, type Signals, type MatterData } from "../signals";
import { requirementsFor, type ExpandedRequirement } from "./playbook";

export { PLAYBOOK, requirementsFor } from "./playbook";

interface Snip { ref: string; date: string | null; text: string }

type SearchFn = (matterId: number, q: string, opts?: { k?: number; expand?: boolean }) => Promise<{ cite: string; header: string; body: string; event_date: string | null }[]>;

let searchFn: SearchFn | null | undefined;
async function getSearch(): Promise<SearchFn | null> {
  if (searchFn !== undefined) return searchFn;
  try {
    const m = (await import("../retrieval/search")) as unknown as { search?: SearchFn };
    searchFn = m.search ?? null;
  } catch {
    searchFn = null;
  }
  return searchFn;
}

/** Keyword fallback over chunks (no embeddings) when retrieval is unavailable. */
async function keywordSearch(matterId: number, q: string, k: number) {
  const r = await db().rpc("hybrid_search", { p_matter: matterId, q_text: q, q_embs: [], match_count: k, kinds: null });
  return ((r.data ?? []) as { cite: string; header: string; body: string; event_date: string | null }[]).slice(0, k);
}

const OWNERS = ["client", "provider", "defense", "carrier", "firm", "court"] as const;
const GateOut = z.object({
  status: z.enum(["have", "partial", "missing", "conflicting"]),
  owed_by: z.enum(OWNERS).nullable(),
  evidence: z.array(z.object({ source_ref: z.string(), quote: z.string() })),
  note: z.string(),
});

const SYSTEM = `You check one requirement on a New York personal-injury case file against the evidence provided.
Decide the status from the evidence ONLY:
- have: the evidence shows the item is actually in the file / done.
- partial: some of it is in (e.g. records only through an earlier date, a total without an itemized bill, requested but incomplete).
- missing: nothing in the evidence shows it is in the file, or the file says it was never obtained.
- conflicting: sources in the evidence disagree about whether it exists or what it says.
A note saying something "will be sent" or "to follow" is not "have". A request is not receipt.
owed_by: who must act next to close it (client, provider, defense, carrier, firm, court); null if have.
evidence: up to 4 items; source_ref must be copied exactly from a [ref] tag in the evidence, quote copied verbatim (short).
note: one plain sentence for the attorney (what is in, what is not, dates). No legal advice beyond the file. Never use em dashes.`;

function factSnips(facts: Fact[], r: ExpandedRequirement): Snip[] {
  const hit = facts.filter((f) => {
    const k = f.event_key ?? "";
    if (r.provider_contact_id != null && f.provider_contact_id === r.provider_contact_id) return true;
    return r.eventKeys.some((p) => k === p || k.startsWith(`${p}.`) || k.startsWith(p));
  });
  return hit.sort((a, b) => b.importance - a.importance).slice(0, 25)
    .map((f) => ({ ref: f.source_ref, date: f.event_date, text: `${f.summary} | quote: "${f.quote}"` }));
}

async function gather(matterId: number, data: MatterData, sig: Signals, r: ExpandedRequirement): Promise<{ snips: Snip[]; extra: string[] }> {
  const snips = factSnips(data.facts, r);
  const search = await getSearch();
  const factById = new Map(data.facts.map((f) => [f.id, f]));
  for (const q of r.search.slice(0, 2)) {
    let hits: { cite: string; header: string; body: string; event_date: string | null }[] = [];
    try {
      hits = search ? await search(matterId, q, { k: 6, expand: false }) : await keywordSearch(matterId, q, 6);
    } catch {
      try { hits = await keywordSearch(matterId, q, 6); } catch { hits = []; }
    }
    for (const h of hits) {
      let ref = h.cite;
      if (ref.startsWith("fact:")) {
        const f = factById.get(ref.slice(5));
        if (!f) continue;
        ref = f.source_ref;
      }
      snips.push({ ref, date: h.event_date, text: `${h.header} ${h.body}`.slice(0, 1500) });
    }
  }
  // deterministic context: pending tasks and comms silence for this provider / requirement
  const extra: string[] = [];
  if (r.provider_contact_id != null) {
    const s = sig.comm.get(r.provider_contact_id);
    if (s) extra.push(`Comms with ${s.name}: last reply ${s.last_inbound ?? "never"}; ${s.unanswered.length} firm requests unanswered since${s.unanswered[0] ? ` ${s.unanswered[0].date}` : ""}.`);
    const toks = r.provider_name ? r.provider_name.toLowerCase().split(/\W+/).filter((w) => w.length >= 5) : [];
    for (const a of sig.actions.filter((x) => x.id.startsWith("task:") && toks.some((t) => x.label.toLowerCase().includes(t)))) {
      snips.push({ ref: a.cite.source_ref, date: a.due_date, text: `Open task (${a.bucket}, due ${a.due_date}): ${a.label}` });
    }
  }
  // dedupe by ref+text start
  const seen = new Set<string>();
  const uniq = snips.filter((s) => { const k = `${s.ref}|${s.text.slice(0, 60)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { snips: uniq.slice(0, 30), extra };
}

function evidenceText(snips: Snip[], extra: string[]): string {
  return [...snips.map((s) => `[${s.ref}]${s.date ? ` (${s.date})` : ""} ${s.text}`), ...extra.map((e) => `[signal] ${e}`)].join("\n\n");
}

export async function checkOne(ctx: RunCtx, data: MatterData, sig: Signals, r: ExpandedRequirement): Promise<GateItem> {
  return ctx.task("gate", r.label.slice(0, 80), async (t) => {
    const { snips, extra } = await gather(ctx.matterId, data, sig, r);
    const allowed = new Set(snips.map((s) => s.ref));
    const ev = evidenceText(snips, extra);
    let status: GateStatus = "missing";
    let owed: Owner | null = r.owner;
    let evidence: Citation[] = [];
    let note: string | null = null;
    let confidence: number | null = null;

    let modelOk = false;
    if (snips.length) {
      try {
        const { data: out, usage } = await structured({
          model: env.swarmModel(), system: SYSTEM, schema: GateOut, schemaName: "gate_status",
          input: `Requirement (${r.phase} exit): ${r.label}\nWhat "have" means: ${r.have}\nTypical owner: ${r.owner}\nToday: ${sig.today}\n\nEVIDENCE\n${ev}`,
          meta: { purpose: "gate", matterId: ctx.matterId, runId: ctx.runId },
        });
        t.usage({ input: usage.input, output: usage.output, cost: usage.cost });
        modelOk = true;
        status = out.status;
        owed = status === "have" ? null : out.owed_by ?? r.owner;
        evidence = out.evidence.filter((e) => allowed.has(e.source_ref))
          .map((e) => ({ source_ref: e.source_ref, quote: e.quote, label: sig.label(e.source_ref) }));
        note = out.note.replace(/[\u2014\u2013]/g, ", ");
        if (status === "have" && evidence.length === 0) { status = "partial"; note = `${note} (no citable evidence returned)`; }
      } catch (e) {
        await t.event(`model unavailable: ${String((e as Error).message).slice(0, 60)}`);
        // fall through: Jev alone decides; evidence = top retrieved snippets
        evidence = snips.slice(0, 3).map((s) => ({ source_ref: s.ref, label: sig.label(s.ref) }));
      }
    } else {
      note = "Nothing in the file mentions this.";
    }

    if (jevAvailable() && snips.length) {
      try {
        const ans = await jev(`Requirement: ${r.label}\nHave means: ${r.have}\n\nEvidence:\n${ev}`.slice(0, 60_000), {
          status: {
            type: "choice",
            instructions: "Based only on the evidence, is this requirement satisfied in the case file?",
            criteria: {
              have: "The evidence shows the item is actually in the file or done.",
              partial: "Some of it is in the file, or it is incomplete, outdated, or only promised.",
              missing: "The evidence does not show the item in the file.",
            },
          },
        }, { purpose: "gate.jev", matterId: ctx.matterId, runId: ctx.runId });
        const a = ans.status;
        if (a && a.type === "choice") {
          const probs = a.probabilities ?? {};
          if (!modelOk) {
            status = a.choice as GateStatus;
            confidence = a.confidence ?? probs[a.choice] ?? null;
            owed = status === "have" ? null : r.owner;
            note = `Status from the auditor over ${snips.length} retrieved sources; not yet reviewed by the gate checker.`;
          } else {
            const mine = status === "conflicting" ? null : probs[status];
            confidence = mine ?? (a.choice === status ? a.confidence ?? null : a.confidence != null ? 1 - a.confidence : null);
            if (status !== "conflicting" && a.choice !== status && (a.confidence ?? 0) >= 0.75 && (mine ?? 0) < 0.2) {
              note = `${note ?? ""} Auditor read it as ${a.choice}.`.trim();
              status = a.choice as GateStatus;
              confidence = a.confidence ?? null;
              if (status === "have") owed = null;
            }
          }
        }
      } catch (e) {
        await t.event(`jev skipped: ${String((e as Error).message).slice(0, 60)}`);
      }
    } else if (!snips.length) confidence = 0.9;
    if (!modelOk && snips.length && confidence == null) {
      throw new Error("gate: no model or auditor available");
    }

    const providerTasks = r.provider_contact_id != null
      ? sig.actions.filter((a) => a.id.startsWith("task:") && a.owner === "provider" && r.provider_name && a.owner_name && a.owner_name.toLowerCase().includes(r.provider_name.toLowerCase().split(/\W+/).find((w) => w.length >= 5) ?? "\u0000"))
      : [];
    const due = providerTasks.map((a) => a.due_date).filter(Boolean).sort()[0] ?? null;
    const s = r.provider_contact_id != null ? sig.comm.get(r.provider_contact_id) : undefined;

    const item: GateItem = {
      requirement_key: r.key, phase: r.phase as Phase, label: r.label, status,
      owed_by: owed, owed_by_contact_id: r.provider_contact_id, owed_by_name: r.provider_name,
      due_date: status === "have" ? null : due,
      days_outstanding: status !== "have" && s?.unanswered[0] ? Math.round((Date.parse(sig.today) - Date.parse(s.unanswered[0].date)) / 86_400_000) : null,
      evidence, note, confidence,
    };
    await db().from("gate_items").upsert({
      matter_id: ctx.matterId, phase: item.phase, requirement_key: item.requirement_key, label: item.label, status: item.status,
      owed_by: item.owed_by, owed_by_contact_id: item.owed_by_contact_id, due_date: item.due_date,
      evidence: item.evidence, note: item.note, confidence: item.confidence, updated_at: new Date().toISOString(),
    }, { onConflict: "matter_id,requirement_key" });
    await t.event(`${status}${evidence.length ? `, ${evidence.length} cites` : ""}`);
    return item;
  });
}

/** Pipeline stage 6: check every gate requirement for the current phase (and unmet earlier ones). */
export async function checkGates(ctx: RunCtx): Promise<GateItem[]> {
  const sig = await computeSignals(ctx.matterId);
  const providers = sig.providers.map((p) => ({ id: p.contact_id, name: p.name }));
  const reqs = requirementsFor(sig.stage, providers);
  const limit = pLimit(Number(process.env.GATE_CONCURRENCY ?? 8));
  const settled = await Promise.allSettled(reqs.map((r) => limit(() => checkOne(ctx, sig.data, sig, r))));
  const items = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const keep = reqs.map((r) => r.key);
  await db().from("gate_items").delete().eq("matter_id", ctx.matterId).not("requirement_key", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  return items;
}
