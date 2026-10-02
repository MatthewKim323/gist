import "server-only";
import { z } from "zod";
import pLimit from "p-limit";
import { db, must } from "../db";
import { embed, structured } from "../llm";
import { env } from "../env";
import { jev, jevAvailable } from "../jev";
import { fetchAll } from "../retrieval";
import type { RunCtx } from "../pipeline/ctx";

// Reconciler: cluster verified facts that talk about the same thing (event_key + embedding proximity),
// merge near-duplicates, then ask one model call per multi-source cluster whether the sources disagree
// or whether one source holds something another treats as unknown ("buried"). Jev double-checks each
// finding before it is written. Generic: nothing here knows about any particular case.

interface FactRow {
  id: string; source_ref: string; kind: string; event_key: string | null; summary: string; quote: string;
  event_date: string | null; importance: number | null;
}
interface F extends FactRow { vec: number[] | null }

const SAME_EVENT_COS = 0.8;
const DUP_COS = 0.92;
const KEY_MERGE_COS = 0.85;
const WINDOW_DAYS = 30;
const MAX_GROUP = 30;
const JEV_MIN = 0.6;

function parseVec(v: unknown): number[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v as number[];
  try { return JSON.parse(String(v)) as number[]; } catch { return null; }
}
function cos(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
function mean(vs: number[][]): number[] {
  const m = new Array(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < v.length; i++) m[i] += v[i] / vs.length;
  return m;
}
const daysApart = (a: string | null, b: string | null) =>
  a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000 : 0;
const baseSource = (ref: string) => ref.replace(/#p\d+$/, "");
const prefix = (k: string | null) => (k ?? "").split(".")[0];

async function loadFacts(matterId: number, runId: string): Promise<F[]> {
  const facts = await fetchAll<FactRow>(
    (a, b) => db().from("facts").select("id,source_ref,kind,event_key,summary,quote,event_date,importance")
      .eq("matter_id", matterId).eq("status", "verified").is("superseded_at", null).order("id").range(a, b),
    "facts",
  );
  const vecRows = await fetchAll<{ source_id: string; embedding: unknown }>(
    (a, b) => db().from("chunks").select("source_id,embedding").eq("matter_id", matterId).eq("source_kind", "fact")
      .order("id").range(a, b),
    "fact chunks",
  );
  const vecs = new Map(vecRows.map((r) => [r.source_id, parseVec(r.embedding)]));
  const out = facts.map((f) => ({ ...f, vec: vecs.get(f.id) ?? null }));
  // Facts not yet indexed: embed them here so clustering still works.
  const miss = out.filter((f) => !f.vec);
  if (miss.length) {
    const es = await embed(miss.map((f) => `${f.summary}\n"${f.quote}"`), { purpose: "reconcile.embed", matterId, runId });
    miss.forEach((f, i) => { f.vec = parseVec(es[i]); });
  }
  return out;
}

/** Group facts: same event_key, keyed groups merged when centroids match, unkeyed facts attached by proximity. */
export function clusterFacts(facts: F[]): F[][] {
  const byKey = new Map<string, F[]>();
  const loose: F[] = [];
  for (const f of facts) {
    if (f.event_key) {
      const k = f.event_key.trim().toLowerCase();
      byKey.set(k, [...(byKey.get(k) ?? []), f]);
    } else loose.push(f);
  }
  let groups = [...byKey.entries()].map(([k, fs]) => ({ key: k, fs }));

  // Merge keyed groups that are clearly about the same thing under slightly different keys.
  const cent = (fs: F[]) => { const vs = fs.map((f) => f.vec).filter(Boolean) as number[][]; return vs.length ? mean(vs) : null; };
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (prefix(groups[i].key) !== prefix(groups[j].key)) continue;
        const a = cent(groups[i].fs), b = cent(groups[j].fs);
        if (a && b && cos(a, b) >= KEY_MERGE_COS) {
          groups[i] = { key: groups[i].key, fs: [...groups[i].fs, ...groups[j].fs] };
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // Attach loose facts to the nearest keyed group, else cluster loose facts among themselves.
  const leftovers: F[] = [];
  for (const f of loose) {
    if (!f.vec) continue;
    let best = -1, bestSim = SAME_EVENT_COS;
    groups.forEach((g, gi) => {
      for (const m of g.fs) {
        if (!m.vec || daysApart(f.event_date, m.event_date) > WINDOW_DAYS) continue;
        const s = cos(f.vec!, m.vec);
        if (s >= bestSim) { bestSim = s; best = gi; }
      }
    });
    if (best >= 0) groups[best].fs.push(f);
    else leftovers.push(f);
  }
  const used = new Set<string>();
  for (const f of leftovers) {
    if (used.has(f.id)) continue;
    used.add(f.id);
    const g = [f];
    for (const o of leftovers) {
      if (used.has(o.id) || daysApart(f.event_date, o.event_date) > WINDOW_DAYS) continue;
      if (cos(f.vec!, o.vec!) >= SAME_EVENT_COS) { g.push(o); used.add(o.id); }
    }
    groups.push({ key: "", fs: g });
  }
  groups = groups.filter((g) => g.fs.length > 0);
  return groups.map((g) =>
    [...g.fs].sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3)).slice(0, MAX_GROUP));
}

/** Near-identical facts about the same event collapse to one keeper; the rest point at it as corroboration. */
export function findDuplicates(group: F[]): Map<string, string> {
  const mergedInto = new Map<string, string>();
  const sorted = [...group].sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3) || b.quote.length - a.quote.length);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (mergedInto.has(a.id) || !a.vec) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (mergedInto.has(b.id) || !b.vec) continue;
      if ((a.event_key ?? "") !== (b.event_key ?? "")) continue;
      if (cos(a.vec, b.vec) >= DUP_COS) mergedInto.set(b.id, a.id);
    }
  }
  return mergedInto;
}

// A fact that says something is missing / unknown / not done. Buried items hide across event keys and
// dates, so each such fact also gets a group of its nearest neighbours from other sources, ignoring keys.
const ABSENCE = /\b(missing|unknown|not (yet )?(been )?(obtained|received|produced|located|found|contacted|investigated|requested|served|provided|in (the )?file)|never (been )?(obtained|received|produced|contacted|investigated|collected|requested)|no one|nobody|none (obtained|in file|on file)|searching for|search(ed)? for|trying to (locate|find|obtain)|outstanding|unanswered|still (need|waiting|not)|have not|has not|hasn't|haven't)\b/i;
const ABSENCE_NEIGHBOURS = 8;
const ABSENCE_MIN_COS = 0.55;

export function absenceGroups(facts: F[]): F[][] {
  const out: F[][] = [];
  for (const f of facts) {
    if (!f.vec || !ABSENCE.test(`${f.summary} ${f.quote}`)) continue;
    const near = facts
      .filter((o) => o.vec && baseSource(o.source_ref) !== baseSource(f.source_ref))
      .map((o) => ({ o, s: cos(f.vec!, o.vec!) }))
      .filter((x) => x.s >= ABSENCE_MIN_COS)
      .sort((a, b) => b.s - a.s)
      .slice(0, ABSENCE_NEIGHBOURS)
      .map((x) => x.o);
    if (near.length) out.push([f, ...near]);
  }
  return out;
}

/** Drop groups whose fact set is contained in a bigger group. */
function dedupGroups(groups: F[][]): F[][] {
  const sets = groups.map((g) => ({ g, ids: new Set(g.map((f) => f.id)) })).sort((a, b) => b.ids.size - a.ids.size);
  const kept: typeof sets = [];
  for (const x of sets) {
    if (kept.some((k) => [...x.ids].every((id) => k.ids.has(id)))) continue;
    kept.push(x);
  }
  return kept.map((k) => k.g);
}

const Finding = z.object({
  type: z.enum(["contradiction", "buried"]),
  title: z.string(),
  why_it_matters: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  claims: z.array(z.object({ fact: z.number().int(), says: z.string() })),
});
const Out = z.object({ findings: z.array(Finding) });

const SYSTEM = `You review verified facts pulled from one personal injury case file. All facts in a request are about the same topic but come from different sources (notes, emails, call logs, documents, forms).
Find two kinds of problems, and only real ones:
1. contradiction: two or more sources give incompatible accounts of the same thing (different mechanism, sequence, date, location, who was involved, whether something exists or was received, whether a prior condition existed, etc.). Differences in detail level or wording are NOT contradictions. Facts from different times that are both true (e.g. a status that later changed) are NOT contradictions unless a source asserts the earlier state after the change.
2. buried: one source says something is unknown, missing, not yet obtained, being searched for, or not investigated, while another source in the set already contains it.
For each finding: a short neutral title (under 12 words), why_it_matters written for the trial lawyer handling the case (e.g. impeachment risk at deposition, credibility with the jury, a defense argument it enables, wasted effort chasing something already in the file), severity (high = could change liability, damages or credibility; medium = needs a fix before discovery or a demand; low = housekeeping), and claims: the fact numbers involved, each with a one-sentence paraphrase of what that source says.
Each finding must cite at least two facts from different sources. Return an empty list when nothing conflicts. Never invent facts.`;

interface Finding_ { type: "contradiction" | "buried"; title: string; why_it_matters: string; severity: "low" | "medium" | "high"; claims: { fact: F; says: string }[] }

async function reviewGroup(ctx: RunCtx, g: F[], label: string): Promise<Finding_[]> {
  return ctx.task("reconcile", label, async (t) => {
    const listing = g.map((f, i) =>
      `#${i} | source ${f.source_ref} | date ${f.event_date ?? "n/a"} | ${f.kind}${f.event_key ? ` ${f.event_key}` : ""}\n   summary: ${f.summary}\n   quote: "${f.quote}"`,
    ).join("\n");
    const { data, usage } = await structured({
      model: env.swarmModel(),
      system: SYSTEM,
      input: `Facts:\n${listing}`,
      schema: Out,
      schemaName: "reconcile_findings",
      meta: { purpose: "reconcile", matterId: ctx.matterId, runId: ctx.runId },
    });
    t.usage(usage);
    const found: Finding_[] = [];
    for (const fd of data.findings) {
      const claims = fd.claims.filter((c) => g[c.fact]).map((c) => ({ fact: g[c.fact], says: c.says }));
      const uniq = new Map(claims.map((c) => [c.fact.id, c]));
      const list = [...uniq.values()];
      if (new Set(list.map((c) => baseSource(c.fact.source_ref))).size < 2) continue;
      found.push({ ...fd, claims: list });
    }

    // Jev audit: keep only findings it rates >= JEV_MIN.
    if (found.length && jevAvailable()) {
      try {
        const state = found.map((fd, i) =>
          `Finding ${i}:\n` + fd.claims.map((c) => `- Source ${c.fact.source_ref} (${c.fact.event_date ?? "undated"}): "${c.fact.quote}"`).join("\n"),
        ).join("\n\n");
        const qs = Object.fromEntries(found.map((fd, i) => [`f${i}`, {
          type: "noul" as const,
          instructions: fd.type === "contradiction"
            ? `In Finding ${i}, these passages describe the same event or fact inconsistently.`
            : `In Finding ${i}, one passage treats something as unknown, missing or not yet obtained while another passage already provides it.`,
        }]));
        const ans = await jev(state, qs, { purpose: "reconcile.jev", matterId: ctx.matterId, runId: ctx.runId });
        const kept = found.filter((_, i) => {
          const a = ans[`f${i}`];
          return !a || a.type !== "noul" || a.noul >= JEV_MIN;
        });
        await t.event(`${kept.length}/${found.length} confirmed`);
        t.facts(kept.length);
        return kept;
      } catch (e) {
        await t.event(`jev skipped: ${String((e as Error).message).slice(0, 80)}`);
      }
    }
    t.facts(found.length);
    return found;
  });
}

export async function reconcileMatter(ctx: RunCtx): Promise<{ groups: number; reviewed: number; merged: number; contradictions: number; buried: number }> {
  const facts = await loadFacts(ctx.matterId, ctx.runId);
  const groups = clusterFacts(facts);

  // Dedup near-identical facts: mark the copy superseded, pointing at the keeper (its corroboration).
  const merges = new Map<string, string>();
  for (const g of groups) for (const [a, b] of findDuplicates(g)) merges.set(a, b);
  if (merges.size) {
    await ctx.task("reconcile", `merge ${merges.size} duplicates`, async () => {
      const now = new Date().toISOString();
      await Promise.all([...merges].map(async ([dup, keep]) =>
        must(await db().from("facts").update({ superseded_at: now, reject_reason: `merged_into:${keep}` }).eq("id", dup), "facts merge")));
    });
  }

  const live = facts.filter((f) => !merges.has(f.id));
  const reviewable = dedupGroups([
    ...groups.map((g) => g.filter((f) => !merges.has(f.id))),
    ...absenceGroups(live),
  ]).filter((g) => new Set(g.map((f) => baseSource(f.source_ref))).size >= 2);

  const limit = pLimit(6);
  const results = await Promise.all(reviewable.map((g, i) =>
    limit(() => reviewGroup(ctx, g, `cluster ${i + 1}/${reviewable.length} (${g.length} facts)`).catch(() => [] as Finding_[]))));
  // Overlapping groups can surface the same finding twice: keep the more severe of any pair sharing most claims.
  const rank = { high: 3, medium: 2, low: 1 } as const;
  const findings: Finding_[] = [];
  for (const fd of results.flat().sort((a, b) => rank[b.severity] - rank[a.severity] || b.claims.length - a.claims.length)) {
    const ids = new Set(fd.claims.map((c) => c.fact.id));
    const dup = findings.some((k) => {
      const shared = k.claims.filter((c) => ids.has(c.fact.id)).length;
      return shared / Math.min(ids.size, k.claims.length) >= 0.5;
    });
    if (!dup) findings.push(fd);
  }

  const rows = findings.map((fd) => {
    const keys = fd.claims.map((c) => c.fact.event_key).filter(Boolean) as string[];
    return {
      matter_id: ctx.matterId,
      run_id: ctx.runId,
      event_key: keys[0] ?? null,
      title: fd.title,
      why_it_matters: fd.why_it_matters,
      severity: fd.severity,
      claims: fd.claims.map((c) => ({
        fact_id: c.fact.id, source_ref: c.fact.source_ref, says: c.says, quote: c.fact.quote,
        date: c.fact.event_date, kind: fd.type,
      })),
    };
  });
  must(await db().from("contradictions").delete().eq("matter_id", ctx.matterId).select("id"), "contradictions clear");
  if (rows.length) must(await db().from("contradictions").insert(rows).select("id"), "contradictions insert");

  return {
    groups: groups.length, reviewed: reviewable.length, merged: merges.size,
    contradictions: findings.filter((f) => f.type === "contradiction").length,
    buried: findings.filter((f) => f.type === "buried").length,
  };
}

/** Corroborating sources for a fact: the near-duplicates merged into it. */
export async function corroborators(matterId: number, factId: string): Promise<string[]> {
  const r = must(await db().from("facts").select("source_ref").eq("matter_id", matterId).eq("reject_reason", `merged_into:${factId}`), "corroborators");
  return (r as { source_ref: string }[]).map((x) => x.source_ref);
}
