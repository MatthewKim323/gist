// gist OS eval harness. Benchmark-style suites adapted to one real matter (see docs/whitepaper/gist-os.md section 4).
//
//   bun run job scripts/eval.ts [matterId] --suites rag,agent      run some suites, write eval/results/suites/<id>.json
//   bun run job scripts/eval.ts --merge                             merge suite files into eval/results/<ts>.json + latest.json
//
// The matter defaults to the most recently synced non-demo matter. The answer key and every reference file under
// eval/reference are read only here; no app code reads them. Every LLM judge prompt is in this file (JUDGE_* below).
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import pLimit from "p-limit";
import { db } from "@/lib/server/db";
import { structured, embed, openai, costOf } from "@/lib/server/llm";
import { search } from "@/lib/server/retrieval/search";
import { ask } from "@/lib/server/retrieval/ask";
import { normalize, tokenOverlap, QUOTE_THRESHOLD } from "@/lib/server/pipeline/verify";
import { runTurn, type AssistantEvent } from "@/lib/server/assistant/agent";

const ROOT = process.cwd();
const REF = path.join(ROOT, "eval/reference");
const OUT = path.join(ROOT, "eval/results");
const SUITE_DIR = path.join(OUT, "suites");
const JUDGE_MODEL = "gpt-5.4-mini";
const BASELINE_MODEL = "gpt-5.5";

const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(REF, f), "utf8")) as T;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pct = (a: number, b: number) => (b ? r3(a / b) : null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

let evalCost = 0;
// The org shares a 200k TPM limit on gpt-5.4-mini with the live app, so back off on 429 instead of failing a suite.
async function retry429<T>(fn: () => Promise<T>, tries = 12): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (i >= tries || !/rate limit|429|fetch failed|ECONNRESET/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1) + Math.random() * 1000));
    }
  }
}
async function judge<T extends z.ZodTypeAny>(system: string, input: string, schema: T, name: string): Promise<z.infer<T>> {
  const { data, usage } = await retry429(() => structured({ model: JUDGE_MODEL, system, input, schema, schemaName: name, meta: { purpose: `eval.${name}`, matterId: null }, reasoning: "low" }));
  evalCost += usage.cost;
  return data;
}

// ---------- data access ----------
async function fetchAll<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let a = 0; ; a += 1000) {
    const r = await q(a, a + 999);
    if (r.error) throw new Error(r.error.message);
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) break;
  }
  return out;
}

async function pickMatter(): Promise<{ id: number; label: string }> {
  const arg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  const r = await db().from("matters").select("id,display_number,client_name,is_demo,synced_at").order("synced_at", { ascending: false });
  const rows = (r.data ?? []) as { id: number; display_number: string; client_name: string; is_demo: boolean | null }[];
  const m = arg ? rows.find((x) => x.id === Number(arg)) : rows.find((x) => !x.is_demo);
  if (!m) throw new Error("no non-demo matter found");
  return { id: Number(m.id), label: `${m.client_name} (${m.display_number})` };
}

interface Fact { id: string; source_ref: string; kind: string; summary: string; quote: string; event_date: string | null; amount_usd: number | null; status: string; reject_reason: string | null; jev_support: string | null; jev_confidence: number | null; quote_score: number | null }
const facts = (m: number) => fetchAll<Fact>((a, b) => db().from("facts")
  .select("id,source_ref,kind,summary,quote,event_date,amount_usd,status,reject_reason,jev_support,jev_confidence,quote_score")
  .eq("matter_id", m).is("superseded_at", null).order("id").range(a, b));

const srcCache = new Map<string, string | null>();
async function sourceText(m: number, ref: string): Promise<string | null> {
  if (srcCache.has(ref)) return srcCache.get(ref)!;
  let text: string | null = null;
  const d = /^doc:(\d+)#p(\d+)$/.exec(ref);
  if (d) {
    const r = await db().from("doc_pages").select("text,version_id").eq("doc_id", Number(d[1])).eq("page", Number(d[2])).order("version_id", { ascending: false }).limit(1).maybeSingle();
    text = (r.data?.text as string | null) ?? null;
  } else {
    const r = await db().from("source_items").select("title,body_text").eq("id", ref).eq("matter_id", m).maybeSingle();
    if (r.data) text = [r.data.title?.trim(), r.data.body_text?.trim()].filter(Boolean).join("\n");
  }
  srcCache.set(ref, text);
  return text;
}

async function corpus(m: number): Promise<{ items: { ref: string; date: string | null; text: string }[]; pages: { ref: string; text: string }[] }> {
  const items = await fetchAll<{ id: string; title: string | null; body_text: string | null; occurred_at: string | null }>((a, b) =>
    db().from("source_items").select("id,title,body_text,occurred_at").eq("matter_id", m).is("deleted_at", null).order("occurred_at").range(a, b));
  const docs = await fetchAll<{ clio_id: number; version_id: number | null; name: string }>((a, b) =>
    db().from("documents").select("clio_id,version_id,name").eq("matter_id", m).order("clio_id").range(a, b));
  const pages: { ref: string; text: string }[] = [];
  for (const d of docs) {
    if (d.version_id == null) continue;
    const ps = await fetchAll<{ page: number; text: string | null }>((a, b) =>
      db().from("doc_pages").select("page,text").eq("doc_id", d.clio_id).eq("version_id", d.version_id!).order("page").range(a, b));
    for (const p of ps) if (p.text?.trim()) pages.push({ ref: `doc:${d.clio_id}#p${p.page}`, text: `${d.name} p${p.page}\n${p.text.trim()}` });
  }
  return {
    items: items.map((i) => ({ ref: i.id, date: i.occurred_at?.slice(0, 10) ?? null, text: [i.title, i.body_text].filter(Boolean).join("\n") })),
    pages,
  };
}

async function digestText(m: number): Promise<string> {
  const r = await db().from("digests").select("json,version").eq("matter_id", m).order("version", { ascending: false }).limit(1).maybeSingle();
  return r.data ? JSON.stringify(r.data.json) : "";
}

const srcOf = (ref: string) => ref.replace(/#p\d+$/, "");

// ---------- suite type ----------
interface Table { title: string; columns: string[]; rows: (string | number | null)[][] }
interface Suite { id: string; name: string; origin: string; adaptation: string; n: number | string; metrics: Record<string, number | string | null>; tables?: Table[]; notes?: string[]; cost_usd?: number; secs?: number }

// ======================================================================================
// 1. Atomic fact recall (FActScore-style decomposition, scored as recall vs a human-written key)
// ======================================================================================
const JUDGE_RECALL =
  "You grade whether a case-digest system surfaced one expected finding about a personal injury case. " +
  "You get the expected finding and the system's output (verified facts retrieved for it, the digest JSON, its contradictions and phase-gate items). " +
  "found=true only if the system's output states the same finding (paraphrase is fine; numbers and dates must match; a partial mention that misses the core point is false). " +
  "Cite the ref or digest field where you saw it. Judge only from the given output, not from your own knowledge.";
const RecallOut = z.object({ found: z.boolean(), where: z.string(), reason: z.string() });

async function gistOutputs(m: number) {
  const [dg, con, gates] = await Promise.all([
    digestText(m),
    db().from("contradictions").select("title,why_it_matters,severity").eq("matter_id", m),
    db().from("gate_items").select("phase,label,status,owed_by,note").eq("matter_id", m),
  ]);
  const conTxt = (con.data ?? []).map((c) => `- ${c.title}: ${c.why_it_matters ?? ""}`).join("\n");
  const gateTxt = (gates.data ?? []).map((g) => `- [${g.status}] ${g.label} (owed by ${g.owed_by ?? "?"}) ${g.note ?? ""}`).join("\n");
  return { dg, conTxt, gateTxt, conRows: con.data ?? [], gateRows: gates.data ?? [] };
}

async function suiteFactRecall(m: number): Promise<Suite> {
  const { items } = readJson<{ items: { id: string; category: string; description: string }[] }>("checklist.json");
  const out = await gistOutputs(m);
  const lim = pLimit(4);
  const res = await Promise.all(items.map((it) => lim(async () => {
    const hits = await retry429(() => search(m, it.description, { k: 8, kinds: ["fact"], expand: false }));
    const input = `Expected finding: ${it.description}\n\n## Verified facts retrieved (hybrid search over gist facts, top 8)\n${hits.map((h) => `[${h.cite}] ${h.body.slice(0, 600)}`).join("\n")}\n\n## Contradictions surfaced\n${out.conTxt || "(none)"}\n\n## Phase gate items\n${out.gateTxt.slice(0, 6000)}\n\n## Digest JSON (truncated to 40k chars)\n${out.dg.slice(0, 40000)}`;
    const j = await judge(JUDGE_RECALL, input, RecallOut, "recall_judge");
    return { ...it, ...j };
  })));
  const cats = [...new Set(items.map((i) => i.category))];
  const found = res.filter((r) => r.found).length;
  return {
    id: "fact_recall", name: "Atomic finding recall (omission rate)",
    origin: "FActScore (Min et al., 2023, arXiv:2305.14251): atomic-fact decomposition, here used for recall instead of precision",
    adaptation: "48 atomic findings hand-written from the independent answer key; an LLM judge (gpt-5.4-mini) checks each against gist's verified facts (top-8 hybrid hits over fact chunks), the digest, contradictions and gate items.",
    n: items.length,
    metrics: { recall: pct(found, items.length), omission_rate: pct(items.length - found, items.length), found, total: items.length },
    tables: [
      { title: "Recall by category", columns: ["category", "found", "total", "recall"], rows: cats.map((c) => { const xs = res.filter((r) => r.category === c); const f = xs.filter((r) => r.found).length; return [c, f, xs.length, pct(f, xs.length)]; }) },
      { title: "Misses (omissions)", columns: ["id", "finding", "judge reason"], rows: res.filter((r) => !r.found).map((r) => [r.id, r.description, r.reason]) },
    ],
  };
}

// ======================================================================================
// 2. Citation precision (ALCE-style citation precision, deterministic + a judged sample)
// ======================================================================================
const JUDGE_SUPPORT =
  "You check one extracted fact against its cited source from a personal injury case file. supported=true only if the source text, read on its own, " +
  "states or directly implies the summary (including any date and amount in it). Answer from the source only.";
const SupportOut = z.object({ supported: z.boolean(), reason: z.string() });

function datePresent(textNorm: string, iso: string): boolean {
  const [y, mo, d] = iso.slice(0, 10).split("-").map(Number);
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const name = months[mo - 1];
  const forms = [`${y} ${String(mo).padStart(2, "0")} ${String(d).padStart(2, "0")}`, `${mo} ${d} ${y}`, `${String(mo).padStart(2, "0")} ${String(d).padStart(2, "0")} ${y}`,
    `${mo} ${d} ${String(y).slice(2)}`, `${String(mo).padStart(2, "0")} ${String(d).padStart(2, "0")} ${String(y).slice(2)}`, `${name} ${d} ${y}`, `${name.slice(0, 3)} ${d} ${y}`, `${d} ${name} ${y}`, `${name} ${d}`, `${name} ${y}`];
  const p = ` ${textNorm} `;
  return forms.some((f) => p.includes(` ${normalize(f)} `));
}
function amountPresent(textNorm: string, a: number): boolean {
  const w = Math.round(a);
  const forms = [String(w), w.toLocaleString("en-US"), a.toFixed(2), Number(a.toFixed(2)).toLocaleString("en-US", { minimumFractionDigits: 2 })];
  if (w % 1000 === 0 && w >= 1000) forms.push(`${w / 1000}k`);
  const p = ` ${textNorm} `;
  return forms.map(normalize).some((f) => f && p.includes(` ${f} `));
}

async function suiteCitation(m: number): Promise<Suite> {
  const all = await facts(m);
  const ver = all.filter((f) => f.status === "verified");
  let exact = 0, overlap = 0, missingSrc = 0, withDate = 0, dateOk = 0, withAmt = 0, amtOk = 0, srcDated = 0;
  const lim = pLimit(4);
  await Promise.all(ver.map((f) => lim(() => sourceText(m, f.source_ref))));
  for (const f of ver) {
    const t = srcCache.get(f.source_ref);
    if (!t) { missingSrc++; continue; }
    const sn = normalize(t);
    const parts = f.quote.split(/\.{3,}|…/).map(normalize).filter((p) => p.length >= 3);
    const ps = parts.length ? parts : [normalize(f.quote)];
    if (ps.every((p) => sn.includes(p))) exact++;
    if (Math.min(...ps.map((p) => (sn.includes(p) ? 1 : tokenOverlap(p, sn).score))) >= QUOTE_THRESHOLD) overlap++;
    if (f.event_date) {
      withDate++;
      if (datePresent(sn, f.event_date)) dateOk++;
      else {
        const it = await db().from("source_items").select("occurred_at").eq("id", f.source_ref).maybeSingle();
        if (it.data?.occurred_at?.slice(0, 10) === f.event_date.slice(0, 10)) { dateOk++; srcDated++; }
      }
    }
    if (f.amount_usd != null) { withAmt++; if (amountPresent(sn, Number(f.amount_usd))) amtOk++; }
  }
  // judged sample: 50 verified facts, deterministic sample (every k-th by id)
  const step = Math.max(1, Math.floor(ver.length / 50));
  const sample = ver.filter((_, i) => i % step === 0).slice(0, 50);
  const judged = await Promise.all(sample.map((f) => lim(async () => {
    const t = srcCache.get(f.source_ref) ?? "";
    const j = await judge(JUDGE_SUPPORT, `Summary: ${f.summary}\nDate: ${f.event_date ?? "none"}\nAmount: ${f.amount_usd ?? "none"}\nQuoted span: "${f.quote}"\n\nSource ${f.source_ref}:\n${t.slice(0, 12000)}`, SupportOut, "support_judge");
    return { f, j };
  })));
  const sup = judged.filter((x) => x.j.supported).length;
  const checked = ver.length - missingSrc;
  return {
    id: "citation_precision", name: "Citation precision",
    origin: "ALCE (Gao et al., 2023, arXiv:2305.14627): citation precision, i.e. does the cited passage support the statement",
    adaptation: "All verified facts re-checked deterministically against the stored source text (fresh normalization, independent of the stored verifier score); plus an LLM judge (gpt-5.4-mini) on a 50-fact systematic sample asking whether the source supports the summary, date and amount.",
    n: `${ver.length} verified facts (deterministic), ${sample.length} judged`,
    metrics: {
      quote_exact_precision: pct(exact, checked), quote_overlap_precision: pct(overlap, checked), source_missing: missingSrc,
      date_present_rate: pct(dateOk, withDate), facts_with_date: withDate, date_matched_via_item_date: srcDated,
      amount_present_rate: pct(amtOk, withAmt), facts_with_amount: withAmt,
      judged_support_precision: pct(sup, sample.length),
    },
    tables: [{ title: "Judged unsupported (sample)", columns: ["source_ref", "summary", "judge reason"], rows: judged.filter((x) => !x.j.supported).map((x) => [x.f.source_ref, x.f.summary, x.j.reason]) }],
  };
}

// ======================================================================================
// 3. Verifier + Jev behavior
// ======================================================================================
async function suiteVerifier(m: number): Promise<Suite> {
  const all = await facts(m);
  const by = (k: (f: Fact) => string) => { const mm = new Map<string, number>(); for (const f of all) mm.set(k(f), (mm.get(k(f)) ?? 0) + 1); return [...mm].sort((a, b) => b[1] - a[1]); };
  const bucket = (r: string | null) => !r ? "(none)" : r.startsWith("quote not found") ? "quote not found in source" : r.startsWith("jev:") ? r.replace(/\s*\([\d.]+\)/, "") : r;
  const rej = all.filter((f) => f.status === "rejected");
  const rev = all.filter((f) => f.status === "needs_review");
  const pick = <T,>(xs: T[], n: number) => { const s = Math.max(1, Math.floor(xs.length / n)); return xs.filter((_, i) => i % s === 0).slice(0, n); };
  const sample = [...pick(rej, 25).map((f) => ({ f, set: "rejected" })), ...pick(rev, 15).map((f) => ({ f, set: "needs_review" }))];
  const lim = pLimit(4);
  const judged = await Promise.all(sample.map((s) => lim(async () => {
    const t = (await sourceText(m, s.f.source_ref)) ?? "(source text not found)";
    const j = await judge(JUDGE_SUPPORT, `Summary: ${s.f.summary}\nDate: ${s.f.event_date ?? "none"}\nAmount: ${s.f.amount_usd ?? "none"}\nQuoted span: "${s.f.quote}"\n\nSource ${s.f.source_ref}:\n${t.slice(0, 12000)}`, SupportOut, "reject_judge");
    return { ...s, j };
  })));
  const rj = judged.filter((x) => x.set === "rejected"), rv = judged.filter((x) => x.set === "needs_review");
  return {
    id: "verifier_jev", name: "Verifier and Jev audit behavior",
    origin: "Internal (no published benchmark); rejection precision framed like a selective-prediction audit",
    adaptation: "Status and reason counts over all current facts from the DB. Precision of rejection = share of a systematic sample of rejected facts that an LLM judge (gpt-5.4-mini) also finds unsupported by the cited source. Same for needs_review.",
    n: `${all.length} facts; judged ${rj.length} rejected + ${rv.length} needs_review`,
    metrics: {
      total: all.length, verified: all.filter((f) => f.status === "verified").length, needs_review: rev.length, rejected: rej.length,
      pending: all.filter((f) => f.status === "pending").length,
      rejection_precision: pct(rj.filter((x) => !x.j.supported).length, rj.length),
      needs_review_unsupported_rate: pct(rv.filter((x) => !x.j.supported).length, rv.length),
    },
    tables: [
      { title: "Status x reason", columns: ["status | reason", "count"], rows: by((f) => `${f.status} | ${bucket(f.reject_reason)}`) },
      { title: "Jev verdicts", columns: ["jev_support", "count"], rows: by((f) => f.jev_support ?? "(not audited)") },
      { title: "Rejected but judged supported (possible false rejections)", columns: ["source_ref", "summary", "reason stored"], rows: rj.filter((x) => x.j.supported).map((x) => [x.f.source_ref, x.f.summary, x.f.reject_reason]) },
    ],
  };
}

// ======================================================================================
// 4. Contradiction detection
// ======================================================================================
const JUDGE_CON_MATCH =
  "You match one known contradiction in a personal injury case file against the list of contradictions and conflicting items a system surfaced. " +
  "matched=true if any surfaced item is about the same conflict (same parties/topic and the same two sides, paraphrase fine). Give the index of the best match or -1.";
const ConMatch = z.object({ matched: z.boolean(), index: z.number().int(), reason: z.string() });
const JUDGE_CON_VALID =
  "You check whether a flagged contradiction in a case file is genuine: the quoted claims from different sources really conflict (not a paraphrase, not compatible facts, not a later update that supersedes an earlier plan). valid=true if a lawyer would agree it is a real conflict worth flagging.";
const ConValid = z.object({ valid: z.boolean(), reason: z.string() });

async function suiteContradictions(m: number): Promise<Suite> {
  const key = readJson<{ items: { id: string; title: string }[] }>("contradictions.json").items;
  const con = (await db().from("contradictions").select("id,title,why_it_matters,severity,claims").eq("matter_id", m)).data ?? [];
  const gates = ((await db().from("gate_items").select("label,note,status").eq("matter_id", m)).data ?? []).filter((g) => g.status === "conflicting");
  const surfaced = [...con.map((c) => `${c.title}: ${c.why_it_matters ?? ""}`), ...gates.map((g) => `[gate conflicting] ${g.label}: ${g.note ?? ""}`)];
  const list = surfaced.map((s, i) => `${i}. ${s}`).join("\n");
  const lim = pLimit(4);
  const matches = await Promise.all(key.map((k) => lim(async () => ({ k, j: await judge(JUDGE_CON_MATCH, `Known contradiction: ${k.title}\n\nSurfaced:\n${list || "(none)"}`, ConMatch, "con_match") }))));
  const valid = await Promise.all(con.slice(0, 20).map((c) => lim(async () => ({ c, j: await judge(JUDGE_CON_VALID, `Title: ${c.title}\nWhy: ${c.why_it_matters}\nClaims: ${JSON.stringify(c.claims).slice(0, 6000)}`, ConValid, "con_valid") }))));
  const hit = matches.filter((x) => x.j.matched).length;
  return {
    id: "contradictions", name: "Contradiction detection",
    origin: "Internal; hit rate against the 21 contradictions in the answer key (section 1.8), LLM-matched",
    adaptation: "Surfaced = contradictions table + gate items with status 'conflicting'. Hit rate: share of key contradictions an LLM judge matches to a surfaced item. Validity: LLM judge on each surfaced contradiction's quoted claims.",
    n: `${key.length} key contradictions; ${con.length} surfaced contradictions (+${gates.length} conflicting gates); ${valid.length} judged for validity`,
    metrics: { hit_rate: pct(hit, key.length), hits: hit, key_total: key.length, surfaced: con.length + gates.length, surfaced_valid_rate: pct(valid.filter((v) => v.j.valid).length, valid.length) },
    tables: [
      { title: "Key contradictions", columns: ["id", "contradiction", "matched", "surfaced match"], rows: matches.map((x) => [x.k.id, x.k.title, x.j.matched ? "yes" : "no", x.j.matched && surfaced[x.j.index] ? surfaced[x.j.index].slice(0, 140) : ""]) },
      { title: "Surfaced contradictions judged", columns: ["title", "severity", "valid", "reason"], rows: valid.map((v) => [v.c.title, v.c.severity, v.j.valid ? "yes" : "no", v.j.reason]) },
    ],
  };
}

// ======================================================================================
// 5. RAG suite (RAGAS) + retrieval ablation
// ======================================================================================
interface QA { id: string; question: string; gold_answer: string; gold_refs: string[] }
const JUDGE_RAGAS =
  "You score one question-answering example from a case-file assistant, following the RAGAS metric definitions. Inputs: question, the system's answer, numbered retrieved contexts, and a gold answer.\n" +
  "1) answer_claims: split the system answer into atomic claims; supported=true only if the claim can be inferred from the retrieved contexts (faithfulness).\n" +
  "2) reverse_questions: write 3 questions that the system answer would answer (used for answer relevancy).\n" +
  "3) context_relevant: for EACH numbered context in order, true if it is useful for producing the gold answer (context precision).\n" +
  "4) gold_statements: split the gold answer into atomic statements; attributable=true if the retrieved contexts contain it (context recall).\n" +
  "5) correctness: 1 if the system answer agrees with the gold answer on every key point, 0.5 if partially, 0 if wrong or missing. Abstaining scores 0.";
const RagasOut = z.object({
  answer_claims: z.array(z.object({ claim: z.string(), supported: z.boolean() })),
  reverse_questions: z.array(z.string()),
  context_relevant: z.array(z.boolean()),
  gold_statements: z.array(z.object({ statement: z.string(), attributable: z.boolean() })),
  correctness: z.number(),
});
const JUDGE_CORRECT = "You grade an answer to a question about a personal injury case against a gold answer. correctness: 1 if it agrees on every key point, 0.5 partial, 0 wrong or missing.";
const CorrectOut = z.object({ correctness: z.number(), reason: z.string() });

function cos(a: number[], b: number[]) { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); }
const vec = (s: string) => JSON.parse(s) as number[];

function recallAt(cites: string[], gold: string[], k: number) {
  const top = new Set(cites.slice(0, k).map(srcOf));
  const g = [...new Set(gold.map(srcOf))];
  return { any: g.some((x) => top.has(x)) ? 1 : 0, frac: g.filter((x) => top.has(x)).length / g.length };
}

async function suiteRag(m: number): Promise<Suite[]> {
  const qa = readJson<{ items: QA[] }>("qa.json").items;
  const lim = pLimit(4);
  const t0 = Date.now();
  const res = await Promise.all(qa.map((q) => lim(async () => {
    const s = Date.now();
    const a = await retry429(() => ask(m, q.question));
    const latency = Date.now() - s;
    const ctx = a.hits.slice(0, 10);
    const j = await judge(JUDGE_RAGAS, `Question: ${q.question}\n\nSystem answer:\n${a.answer_markdown}\n\nRetrieved contexts:\n${ctx.map((h, i) => `[${i}] (${h.cite}) ${h.body.slice(0, 1500)}`).join("\n\n")}\n\nGold answer: ${q.gold_answer}`, RagasOut, "ragas_judge");
    const embs = (await embed([q.question, ...j.reverse_questions.slice(0, 3)], { purpose: "eval.ragas_embed", matterId: null })).map(vec);
    const relevancy = j.reverse_questions.length ? mean(embs.slice(1).map((e) => cos(embs[0], e))) : 0;
    const faith = j.answer_claims.length ? j.answer_claims.filter((c) => c.supported).length / j.answer_claims.length : 0;
    const rel = j.context_relevant.slice(0, ctx.length);
    let hitsSoFar = 0, ap = 0;
    rel.forEach((r, i) => { if (r) { hitsSoFar++; ap += hitsSoFar / (i + 1); } });
    const cprec = hitsSoFar ? ap / hitsSoFar : 0;
    const crec = j.gold_statements.length ? j.gold_statements.filter((g) => g.attributable).length / j.gold_statements.length : 0;
    const cites = a.hits.map((h) => h.cite);
    return { q, answer: a.answer_markdown, faith, relevancy, cprec, crec, correct: j.correctness, latency, r5: recallAt(cites, q.gold_refs, 5), r10: recallAt(cites, q.gold_refs, 10), citeRefs: a.cites.map((c) => c.source_ref) };
  })));
  const secs = (Date.now() - t0) / 1000;
  const rag: Suite = {
    id: "rag", name: "RAG quality (Ask the case)",
    origin: "RAGAS (Es et al., 2023, arXiv:2309.15217): faithfulness, answer relevancy, context precision, context recall",
    adaptation: "25 questions with gold answers and gold source refs written from the answer key. System = lib/server/retrieval/ask (query expansion + hybrid search k=15 + gpt-5.5 answer over verified facts and passages). One gpt-5.4-mini judge call per question produces the RAGAS intermediate judgments; answer relevancy = mean cosine (text-embedding-3-large) between the question and 3 judge-generated reverse questions, as in RAGAS. Contexts scored = top-10 retrieved passages.",
    n: qa.length,
    metrics: {
      faithfulness: r3(mean(res.map((r) => r.faith))), answer_relevancy: r3(mean(res.map((r) => r.relevancy))),
      context_precision: r3(mean(res.map((r) => r.cprec))), context_recall: r3(mean(res.map((r) => r.crec))),
      answer_correctness: r3(mean(res.map((r) => r.correct))),
      retrieval_hit_at_5: r3(mean(res.map((r) => r.r5.any))), retrieval_hit_at_10: r3(mean(res.map((r) => r.r10.any))),
      gold_ref_recall_at_10: r3(mean(res.map((r) => r.r10.frac))),
      median_latency_s: r3([...res.map((r) => r.latency)].sort((a, b) => a - b)[Math.floor(res.length / 2)] / 1000),
    },
    tables: [{ title: "Per question", columns: ["id", "question", "correct", "faithful", "ctx precision", "ctx recall", "hit@10"], rows: res.map((r) => [r.q.id, r.q.question, r.correct, r3(r.faith), r3(r.cprec), r3(r.crec), r.r10.any]) }],
    secs,
  };
  fs.writeFileSync(path.join(SUITE_DIR, "rag.answers.json"), JSON.stringify(res.map((r) => ({ id: r.q.id, answer: r.answer, cites: r.citeRefs })), null, 2));

  // ablation: raw hybrid_search RPC, no expansion, no dedup, source kinds only (no fact chunks, so cites are source refs)
  const kinds = ["note", "email", "call", "task", "calendar", "expense", "field", "contact", "relationship", "doc"];
  const qEmbs = await embed(qa.map((q) => q.question), { purpose: "eval.ablation_embed", matterId: null });
  const modes = { hybrid: (i: number) => ({ q_text: qa[i].question, q_embs: [qEmbs[i]] }), vector_only: (i: number) => ({ q_text: "", q_embs: [qEmbs[i]] }), keyword_only: (i: number) => ({ q_text: qa[i].question, q_embs: [] as string[] }) };
  const rows: (string | number | null)[][] = [];
  const metrics: Record<string, number> = {};
  for (const [mode, args] of Object.entries(modes)) {
    const rs = await Promise.all(qa.map((q, i) => lim(async () => {
      const r = await db().rpc("hybrid_search", { p_matter: m, ...args(i), match_count: 10, kinds, audiences: ["firm", "provider_ok"] });
      if (r.error) throw new Error(`hybrid_search ${mode}: ${r.error.message}`);
      const cites = (r.data ?? []).map((x: { cite: string }) => x.cite);
      return { r5: recallAt(cites, q.gold_refs, 5), r10: recallAt(cites, q.gold_refs, 10) };
    })));
    const h5 = r3(mean(rs.map((x) => x.r5.any))), h10 = r3(mean(rs.map((x) => x.r10.any))), g5 = r3(mean(rs.map((x) => x.r5.frac))), g10 = r3(mean(rs.map((x) => x.r10.frac)));
    rows.push([mode, h5, h10, g5, g10]);
    metrics[`${mode}_recall_at_10`] = g10;
  }
  const abl: Suite = {
    id: "retrieval_ablation", name: "Retrieval ablation (hybrid vs vector vs keyword)",
    origin: "Standard IR recall@k (as in BEIR, Thakur et al., 2021, arXiv:2104.08663); RRF from Cormack et al., 2009",
    adaptation: "Same 25 questions, gold source refs from qa.json. Raw hybrid_search RPC (RRF k=60) with no query expansion and no dedup; vector-only passes an empty keyword query, keyword-only passes no embeddings. A doc page hit counts for its document. hit@k = any gold source in top k; recall@k = share of gold sources in top k.",
    n: qa.length, metrics,
    tables: [{ title: "Recall by retriever", columns: ["retriever", "hit@5", "hit@10", "recall@5", "recall@10"], rows }],
  };
  return [rag, abl];
}

// ======================================================================================
// 6. Long-document needle retrieval (NIAH / RULER style, real pages, nothing planted)
// ======================================================================================
const GEN_NEEDLE =
  "You write one retrieval test question from a single page of a long medical record. Pick ONE detail that is specific to this page (a visit date together with a finding, a measurement, a named test result) and write a question a lawyer might ask that only this page answers. " +
  "If the page is boilerplate with no distinctive detail, set usable=false.";
const NeedleGen = z.object({ usable: z.boolean(), question: z.string(), answer: z.string() });

async function suiteNeedle(m: number): Promise<Suite> {
  const docs = ((await db().from("documents").select("clio_id,version_id,name,page_count").eq("matter_id", m)).data ?? []).filter((d) => (d.page_count ?? 0) > 50);
  if (!docs.length) return { id: "needle", name: "Long-document needle retrieval", origin: "Needle-in-a-Haystack (Kamradt, 2023); RULER (Hsieh et al., 2024, arXiv:2404.06654)", adaptation: "no document over 50 pages", n: 0, metrics: {} };
  const d = docs.sort((a, b) => (b.page_count ?? 0) - (a.page_count ?? 0))[0];
  const pages = await fetchAll<{ page: number; text: string | null }>((a, b) => db().from("doc_pages").select("page,text").eq("doc_id", d.clio_id).eq("version_id", d.version_id).order("page").range(a, b));
  const n = pages.length;
  const buckets = [[1, 25], [26, 50], [51, 75], [76, 100], [101, n]].filter(([lo]) => lo <= n);
  const picks: { page: number; text: string; bucket: string }[] = [];
  for (const [lo, hi] of buckets) {
    const inB = pages.filter((p) => p.page >= lo && p.page <= hi && (p.text ?? "").length > 300);
    const step = Math.max(1, Math.floor(inB.length / 4));
    for (let i = 0; i < inB.length && picks.filter((p) => p.bucket === `${lo}-${hi}`).length < 4; i += step) picks.push({ page: inB[i].page, text: inB[i].text!, bucket: `${lo}-${hi}` });
  }
  const lim = pLimit(4);
  const res = await Promise.all(picks.map((p) => lim(async () => {
    const g = await judge(GEN_NEEDLE, `Document: ${d.name}, page ${p.page}\n\n${p.text.slice(0, 6000)}`, NeedleGen, "needle_gen");
    if (!g.usable) return null;
    const hits = await search(m, g.question, { k: 10, expand: false });
    const cites = hits.map((h) => h.cite);
    const ref = `doc:${d.clio_id}#p${p.page}`;
    return { ...p, q: g.question, page_hit: cites.includes(ref) ? 1 : 0, doc_hit: cites.some((c) => c.startsWith(`doc:${d.clio_id}#`)) ? 1 : 0, rank: cites.indexOf(ref) + 1 };
  })));
  const ok = res.filter((x): x is NonNullable<typeof x> => !!x);
  fs.writeFileSync(path.join(SUITE_DIR, "needle.questions.json"), JSON.stringify(ok.map((x) => ({ page: x.page, bucket: x.bucket, question: x.q, page_hit: x.page_hit, rank: x.rank })), null, 2));
  return {
    id: "needle", name: "Long-document needle retrieval",
    origin: "Needle-in-a-Haystack (Kamradt, 2023) and RULER (Hsieh et al., 2024, arXiv:2404.06654); here on real pages, nothing planted",
    adaptation: `Longest document in the matter (${d.name}, ${n} pages). Up to 4 pages per depth bucket chosen systematically; gpt-5.4-mini writes one question per page from a page-specific detail (questions committed in eval/results/suites/needle.questions.json). Retrieval = gist hybrid search (k=10, no expansion, with dedup). Page hit = the exact page in top 10. Caveat: daily treatment notes are repetitive, so near-duplicate pages make page-level hits harder and doc-level hits easier.`,
    n: ok.length,
    metrics: { page_recall_at_10: pct(ok.reduce((s, x) => s + x.page_hit, 0), ok.length), doc_recall_at_10: pct(ok.reduce((s, x) => s + x.doc_hit, 0), ok.length), doc_pages: n },
    tables: [{ title: "Recall by page depth", columns: ["pages", "n", "page hit@10", "doc hit@10"], rows: buckets.map(([lo, hi]) => { const xs = ok.filter((x) => x.bucket === `${lo}-${hi}`); return [`${lo}-${hi}`, xs.length, pct(xs.reduce((s, x) => s + x.page_hit, 0), xs.length), pct(xs.reduce((s, x) => s + x.doc_hit, 0), xs.length)]; }) }],
  };
}

// ======================================================================================
// 7. Agent harness (tau-bench style pass^k)
// ======================================================================================
interface AgentTask { id: string; message: string; tools_any: string[]; must: RegExp[]; tab?: string | null }
const AGENT_TASKS: AgentTask[] = [
  { id: "a01", message: "What is the case worth and what coverage is behind it?", tools_any: ["get_money", "get_overview"], must: [/375,?000|375k/i, /100,?000|100k/i] },
  { id: "a02", message: "Which tasks are overdue right now?", tools_any: ["get_next_actions"], must: [/mcculloch|capiola/i, /employment|commission/i] },
  { id: "a03", message: "When did anyone last talk to the client?", tools_any: ["get_overview", "get_next_actions", "search_case"], must: [/(2026-09-27|sep(tember)?\.? 27)/i] },
  { id: "a04", message: "Who is Kyle Pullano and why does he matter?", tools_any: ["search_case", "get_red_flags"], must: [/passenger/i] },
  { id: "a05", message: "What did the defense orthopedic IME conclude?", tools_any: ["search_case", "get_source"], must: [/resolved|return to work|without restriction/i] },
  { id: "a06", message: "What is the status of the right shoulder surgery?", tools_any: ["search_case", "get_treatment", "get_next_actions"], must: [/no (surgical )?date|undated|not (yet )?(been )?scheduled|no date/i] },
  { id: "a07", message: "What are the medical specials and why aren't they final?", tools_any: ["get_money", "search_case"], must: [/118,?400/i, /ledger|reconcil/i] },
  { id: "a08", message: "What are the biggest contradictions in this file?", tools_any: ["get_red_flags"], must: [/account|pullano|incident report|ankle|coverage/i] },
  { id: "a09", message: "How much is the Medicaid lien?", tools_any: ["get_money", "search_case"], must: [/22,?180/i] },
  { id: "a10", message: "What does the firm need to move this case to the next phase?", tools_any: ["get_phase_checklist", "get_next_actions"], must: [/surg|records|ledger|deposition|discovery/i] },
];

function numbersIn(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)) out.add(m[1].replace(/,/g, "").replace(/\.00$/, ""));
  for (const m of s.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  return [...out];
}

async function suiteAgent(m: number): Promise<Suite> {
  const { items, pages } = await corpus(m);
  const dg = await digestText(m);
  const corpusText = [...items.map((i) => `${i.date ?? ""} ${i.text}`), ...pages.map((p) => p.text), dg].join("\n").replace(/,/g, "");
  const corpusDates = new Set<string>();
  for (const i of items) if (i.date) corpusDates.add(i.date);
  const inCorpus = (n: string) => /^\d{4}-\d{2}-\d{2}$/.test(n) ? corpusDates.has(n) || corpusText.includes(n) || (() => { const [y, mo, d] = n.split("-").map(Number); return corpusText.includes(`${mo}/${d}/${y}`) || corpusText.includes(`${String(mo).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`); })() : corpusText.includes(n) || corpusText.includes(Number(n).toFixed(2));
  const refOk = async (r: string) => r.startsWith("fact:") ? !!(await db().from("facts").select("id").eq("id", r.slice(5)).maybeSingle()).data : !!(await sourceText(m, r));
  const profile = `eval-agent-${Date.now()}`;
  const trials = 2;
  const runs: { task: AgentTask; trial: number; pass: boolean; checks: Record<string, boolean>; steps: number; latency: number; cost: number; invented: string[] }[] = [];
  const lim = pLimit(4);
  try {
    await Promise.all(AGENT_TASKS.flatMap((task) => Array.from({ length: trials }, (_, trial) => lim(async () => {
      const ev: AssistantEvent[] = [];
      const s = Date.now();
      await retry429(() => { ev.length = 0; return runTurn({ matterId: m, profileId: `${profile}-${task.id}-${trial}`, viewer: null, message: task.message, tab: null }, (e) => ev.push(e)); }, 6);
      const latency = Date.now() - s;
      const done = ev.find((e) => e.type === "done") as Extract<AssistantEvent, { type: "done" }> | undefined;
      const tools = ev.filter((e) => e.type === "tool").map((e) => (e as { name: string }).name);
      const text = done?.text ?? "";
      const refs = done?.cites.map((c) => c.source_ref) ?? [];
      const valid = await Promise.all(refs.map(refOk));
      const invented = numbersIn(text).filter((n) => !inCorpus(n));
      const checks = {
        required_tool: task.tools_any.some((t) => tools.includes(t)),
        cites_present_and_valid: refs.length > 0 && valid.every(Boolean),
        gold_facts: task.must.every((re) => re.test(text)),
        no_invented_numbers: invented.length === 0,
      };
      runs.push({ task, trial, pass: Object.values(checks).every(Boolean), checks, steps: tools.length, latency, cost: done?.costUsd ?? 0, invented });
    }))));
  } finally {
    const ids = ((await db().from("assistant_threads").select("id").like("profile_id", `${profile}%`)).data ?? []).map((t) => t.id);
    if (ids.length) await db().from("assistant_threads").delete().in("id", ids);
    await db().from("profile_memories").delete().like("profile_id", `${profile}%`);
  }
  const per = AGENT_TASKS.map((t) => { const rs = runs.filter((r) => r.task.id === t.id); const c = rs.filter((r) => r.pass).length; return { t, c, rs }; });
  const turnCost = runs.reduce((s, r) => s + r.cost, 0);
  const checkRate = (k: string) => pct(runs.filter((r) => (r.checks as Record<string, boolean>)[k]).length, runs.length);
  return {
    id: "agent", name: "Agent harness (Ask gist OS)",
    origin: "tau-bench (Yao et al., 2024, arXiv:2406.12045): programmatic task checks and the pass^k reliability metric",
    adaptation: "10 tasks for the Ask gist assistant (lib/server/assistant/agent.ts, gpt-5.4-mini tool loop, max 5 steps), 2 trials each, fresh throwaway profile per trial (rows deleted after). Pass requires all four checks: a required tool was called; at least one citation and every cited ref exists in the case; the answer contains the gold key facts (regex); every $ amount and ISO date in the answer appears in the case corpus (source items, doc pages, digest). pass^1 = mean success; pass^2 = share of tasks passing both trials.",
    n: `${AGENT_TASKS.length} tasks x ${trials} trials`,
    metrics: {
      pass_hat_1: r3(mean(per.map((p) => p.c / trials))), pass_hat_2: r3(mean(per.map((p) => (p.c === trials ? 1 : 0)))),
      required_tool_rate: checkRate("required_tool"), cite_valid_rate: checkRate("cites_present_and_valid"), gold_fact_rate: checkRate("gold_facts"), no_invented_numbers_rate: checkRate("no_invented_numbers"),
      avg_tool_steps: r3(mean(runs.map((r) => r.steps))), median_latency_s: r3([...runs.map((r) => r.latency)].sort((a, b) => a - b)[Math.floor(runs.length / 2)] / 1000),
      avg_turn_cost_usd: r3(turnCost / Math.max(1, runs.length) * 1000) / 1000,
    },
    tables: [{ title: "Per task", columns: ["id", "task", "passes / 2", "failed checks"], rows: per.map((p) => [p.t.id, p.t.message, p.c, [...new Set(p.rs.flatMap((r) => Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k + (k === "no_invented_numbers" ? ` (${r.invented.join(" ")})` : ""))))].join("; ")]) }],
  };
}

// ======================================================================================
// 8. Memory (LongMemEval style)
// ======================================================================================
const JUDGE_MEM =
  "You grade a case assistant's answer to a question about what the USER told it in earlier sessions. Expected behavior is given. " +
  "pass=true if the answer matches the expected behavior (for abstention: it must say it does not know / was not told, and must not invent an answer).";
const MemOut = z.object({ pass: z.boolean(), reason: z.string() });

async function suiteMemory(m: number): Promise<Suite> {
  const profile = `eval-mem-${Date.now()}`;
  const say = async (message: string) => {
    const ev: AssistantEvent[] = [];
    await retry429(() => { ev.length = 0; return runTurn({ matterId: m, profileId: profile, viewer: null, message, tab: null }, (e) => ev.push(e)); }, 6);
    const done = ev.find((e) => e.type === "done") as Extract<AssistantEvent, { type: "done" }> | undefined;
    return { text: done?.text ?? "", cost: done?.costUsd ?? 0, recalled: (ev.find((e) => e.type === "recalled") as { items?: string[] } | undefined)?.items ?? [] };
  };
  // Each runTurn without threadId opens a new thread, so every message below is its own session.
  const session1 = [
    "Remember this about me: I always want the money numbers first, before anything else.",
    "Remember: I'm the attorney on this file and my main focus is the scope-of-employment question with Metro-North.",
    "Remember that I track Dr. Capiola personally; flag anything about him.",
  ];
  const update = ["Update for you: I've changed my mind, stop leading with money. Lead with the next deadline instead."];
  const probes = [
    { cat: "single-session recall", q: "What is my main focus on this file? Answer from what you remember about me.", expect: "Says the user's main focus is the scope-of-employment question with Metro-North." },
    { cat: "single-session recall", q: "Which doctor did I ask you to flag for me?", expect: "Dr. Capiola." },
    { cat: "knowledge update", q: "How do I want my answers ordered? Answer from what you remember about me.", expect: "Lead with the next deadline (the updated preference), not money first." },
    { cat: "temporal", q: "Before my latest change, what did I used to want you to lead with?", expect: "Money numbers first (the earlier preference)." },
    { cat: "abstention", q: "What is my paralegal's favorite lunch spot? Answer from what you remember about me.", expect: "Abstains: was never told; does not invent." },
    { cat: "abstention", q: "What did I tell you my billing rate is?", expect: "Abstains: the user never stated a billing rate." },
  ];
  let cost = 0;
  const stored: string[] = [];
  const results: { cat: string; q: string; pass: boolean; reason: string; recalled: number }[] = [];
  try {
    for (const s of session1) cost += (await say(s)).cost;
    for (const s of update) cost += (await say(s)).cost;
    stored.push(...(((await db().from("profile_memories").select("kind,text,created_at").eq("profile_id", profile).order("created_at")).data ?? []).map((r) => `(${r.kind}) ${r.text}`)));
    for (const p of probes) {
      const a = await say(p.q);
      cost += a.cost;
      const j = await judge(JUDGE_MEM, `Question: ${p.q}\nExpected: ${p.expect}\nAnswer: ${a.text}`, MemOut, "memory_judge");
      results.push({ cat: p.cat, q: p.q, pass: j.pass, reason: j.reason, recalled: a.recalled.length });
    }
  } finally {
    const ids = ((await db().from("assistant_threads").select("id").eq("profile_id", profile)).data ?? []).map((t) => t.id);
    if (ids.length) await db().from("assistant_threads").delete().in("id", ids);
    await db().from("profile_memories").delete().eq("profile_id", profile);
  }
  const cats = [...new Set(probes.map((p) => p.cat))];
  return {
    id: "memory", name: "Per-profile memory",
    origin: "LongMemEval (Wu et al., 2024, arXiv:2410.10813): information extraction, knowledge update, temporal reasoning, abstention",
    adaptation: "Scripted multi-session run against the real assistant with a throwaway profile (all rows deleted after): 3 sessions state preferences/focus, 1 later session updates a preference, then 6 probe sessions. Each message is a new thread, so only profile_memories carries information across. An LLM judge (gpt-5.4-mini) grades each probe against the expected behavior.",
    n: `${probes.length} probes over ${session1.length + update.length + probes.length} sessions`,
    metrics: { accuracy: pct(results.filter((r) => r.pass).length, results.length), memories_stored: stored.length, turn_cost_usd: r3(cost * 1000) / 1000 },
    tables: [
      { title: "By category", columns: ["category", "passed", "n"], rows: cats.map((c) => { const xs = results.filter((r) => r.cat === c); return [c, xs.filter((x) => x.pass).length, xs.length]; }) },
      { title: "Probes", columns: ["category", "question", "pass", "memories recalled", "judge reason"], rows: results.map((r) => [r.cat, r.q, r.pass ? "yes" : "no", r.recalled, r.reason]) },
      { title: "Memories stored after the setup sessions", columns: ["memory"], rows: stored.map((s) => [s]) },
    ],
  };
}

// ======================================================================================
// 9. Cost + latency from the pipeline's own logs
// ======================================================================================
async function suiteCost(m: number): Promise<Suite> {
  const runs = ((await db().from("agent_runs").select("id,status,started_at,finished_at,cost_usd").eq("matter_id", m).order("started_at")).data ?? []);
  const tasksFor = async (id: string) => (await db().from("agent_tasks").select("role,status,started_at,finished_at,cost_usd,tokens_in,tokens_out").eq("run_id", id)).data ?? [];
  const summ = async (r: { id: string; started_at: string; finished_at: string | null; cost_usd: number | null }) => {
    const ts = await tasksFor(r.id);
    const roles = [...new Set(ts.map((t) => t.role))];
    return {
      run: r, ts,
      secs: r.finished_at ? (Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000 : null,
      roles: roles.map((role) => {
        const xs = ts.filter((t) => t.role === role);
        const st = xs.map((t) => t.started_at).filter(Boolean).map((x) => Date.parse(x!)), fi = xs.map((t) => t.finished_at).filter(Boolean).map((x) => Date.parse(x!));
        return { role, tasks: xs.length, cached: xs.filter((t) => t.status === "cached").length, cost: xs.reduce((s, t) => s + Number(t.cost_usd ?? 0), 0), tokens_in: xs.reduce((s, t) => s + Number(t.tokens_in ?? 0), 0), wall: st.length && fi.length ? (Math.max(...fi) - Math.min(...st)) / 1000 : null };
      }),
    };
  };
  const full = [];
  for (const r of runs.filter((x) => x.status === "done")) {
    const s = await summ(r as never);
    if (["extract", "synth"].every((role) => s.roles.some((x) => x.role === role))) full.push(s);
  }
  const cold = [...full].sort((a, b) => Number(b.run.cost_usd ?? 0) - Number(a.run.cost_usd ?? 0))[0];
  const warm = [...full].reverse().find((s) => (s.roles.find((x) => x.role === "extract")?.cached ?? 0) > 0 && s.roles.filter((x) => x.role === "extract").every((x) => x.cached === x.tasks));
  const calls = await fetchAll<{ purpose: string | null; model: string; cost_usd: number | null; input_tokens: number | null; output_tokens: number | null; latency_ms: number | null }>((a, b) =>
    db().from("llm_calls").select("purpose,model,cost_usd,input_tokens,output_tokens,latency_ms").eq("matter_id", m).order("id").range(a, b));
  const byPurpose = new Map<string, { n: number; cost: number; tin: number; tout: number }>();
  for (const c of calls) { const k = `${c.purpose ?? "?"} | ${c.model}`; const v = byPurpose.get(k) ?? { n: 0, cost: 0, tin: 0, tout: 0 }; v.n++; v.cost += Number(c.cost_usd ?? 0); v.tin += c.input_tokens ?? 0; v.tout += c.output_tokens ?? 0; byPurpose.set(k, v); }
  const stageRows = (s: typeof cold | undefined) => s ? s.roles.map((x) => [x.role, x.tasks, x.cached, r3(x.cost * 1000) / 1000, x.tokens_in, x.wall == null ? null : r3(x.wall)]) : [];
  return {
    id: "cost_latency", name: "Cost and latency per case",
    origin: "Internal (from agent_runs, agent_tasks and llm_calls)",
    adaptation: "Cold run = the completed full pipeline run (extract + synth present) with the highest logged cost; warm run = latest completed full run whose extraction tasks were all cache hits. Costs are tokens x the hardcoded price table in lib/server/llm.ts (Jev cost is estimated from characters / 4). No fresh rerun was done for this eval to avoid mutating the live matter; timings are from logged runs.",
    n: `${runs.length} logged runs; ${full.length} complete full runs; ${calls.length} logged LLM calls`,
    metrics: {
      cold_run_cost_usd: cold ? r3(Number(cold.run.cost_usd) * 1000) / 1000 : null, cold_run_secs: cold?.secs ?? null, cold_run_id: cold?.run.id ?? null,
      warm_run_cost_usd: warm ? r3(Number(warm.run.cost_usd) * 1000) / 1000 : null, warm_run_secs: warm?.secs ?? null, warm_run_id: warm?.run.id ?? null,
      all_logged_llm_cost_usd: r3(calls.reduce((s, c) => s + Number(c.cost_usd ?? 0), 0) * 1000) / 1000,
      all_runs_cost_usd: r3(runs.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0) * 1000) / 1000,
    },
    tables: [
      { title: "Cold run by stage", columns: ["stage", "tasks", "cached", "cost $", "tokens in", "wall s"], rows: stageRows(cold) },
      { title: "Warm (cached) run by stage", columns: ["stage", "tasks", "cached", "cost $", "tokens in", "wall s"], rows: stageRows(warm) },
      { title: "All logged LLM calls for this matter by purpose", columns: ["purpose | model", "calls", "cost $", "tokens in", "tokens out"], rows: [...byPurpose].sort((a, b) => b[1].cost - a[1].cost).map(([k, v]) => [k, v.n, r3(v.cost * 1000) / 1000, v.tin, v.tout]) },
    ],
  };
}

// ======================================================================================
// 10. Single-shot long-context baseline (gpt-5.5)
// ======================================================================================
const BASELINE_SYSTEM =
  "You are given the complete file of one personal injury case (notes, emails, calls, tasks, calendar, custom fields, expenses, and document pages). " +
  "Part A: write a complete case digest for the handling lawyer: the story, injuries and treatment, money (value, coverage, specials, liens, wage loss, spend), liability and risk, defense experts, overdue/upcoming items and who is holding them, last client contact, and every contradiction between sources. Be specific with dates and amounts. " +
  "Part B: answer each numbered question briefly. Use only the file.";

async function suiteBaseline(m: number, qaOnly = false): Promise<Suite> {
  void qaOnly;
  const { items, pages } = await corpus(m);
  const qa = readJson<{ items: QA[] }>("qa.json").items;
  const chk = readJson<{ items: { id: string; category: string; description: string }[] }>("checklist.json").items;
  const MAX_CHARS = 900_000; // ~225k tokens at 4 chars/token, under the model's context window
  let body = "";
  let included = 0;
  const all = [...items.map((i) => `<item ref="${i.ref}" date="${i.date ?? ""}">\n${i.text}\n</item>`), ...pages.map((p) => `<page ref="${p.ref}">\n${p.text}\n</page>`)];
  for (const s of all) { if (body.length + s.length > MAX_CHARS) break; body += s + "\n"; included++; }
  const Out = z.object({ digest: z.string(), answers: z.array(z.object({ id: z.string(), answer: z.string() })) });
  // One run only: if the baseline output is already saved (a judge step failed after the expensive call), reuse it.
  const saved = path.join(SUITE_DIR, "baseline.output.json");
  let out: z.infer<typeof Out>;
  let meta: { input_tokens: number; output_tokens: number; cost: number; secs: number };
  if (fs.existsSync(saved)) {
    const j = JSON.parse(fs.readFileSync(saved, "utf8"));
    out = { digest: j.digest, answers: j.answers };
    meta = j.meta;
  } else {
    const t0 = Date.now();
    const res = await openai().responses.parse({
      model: BASELINE_MODEL, instructions: BASELINE_SYSTEM,
      input: `${body}\n\n## Questions\n${qa.map((q) => `${q.id}. ${q.question}`).join("\n")}`,
      text: { format: (await import("openai/helpers/zod")).zodTextFormat(Out, "baseline") }, reasoning: { effort: "low" },
    });
    const u = res.usage;
    meta = { input_tokens: u?.input_tokens ?? 0, output_tokens: u?.output_tokens ?? 0, cost: costOf(BASELINE_MODEL, u?.input_tokens ?? 0, u?.output_tokens ?? 0, u?.input_tokens_details?.cached_tokens ?? 0), secs: (Date.now() - t0) / 1000 };
    out = res.output_parsed!;
    fs.writeFileSync(saved, JSON.stringify({ ...out, meta }, null, 2));
  }
  evalCost += meta.cost;
  const cost = meta.cost, secs = meta.secs;
  const lim = pLimit(4);
  const rec = await Promise.all(chk.map((it) => lim(async () => ({ it, j: await judge(JUDGE_RECALL, `Expected finding: ${it.description}\n\n## System output (single-shot digest)\n${out.digest}`, RecallOut, "recall_judge_baseline") }))));
  const cor = await Promise.all(qa.map((q) => lim(async () => {
    const a = out.answers.find((x) => x.id === q.id)?.answer ?? "";
    return (await judge(JUDGE_CORRECT, `Question: ${q.question}\nGold: ${q.gold_answer}\nAnswer: ${a}`, CorrectOut, "correct_judge_baseline")).correctness;
  })));
  const cats = [...new Set(chk.map((i) => i.category))];
  return {
    id: "baseline", name: "Single-shot long-context baseline",
    origin: "Long-context baseline in the style of RAG-vs-long-context comparisons (Li et al., 2024, arXiv:2407.16833)",
    adaptation: `One ${BASELINE_MODEL} call (reasoning low) given the whole case text (all source items, then doc pages, cut at ${MAX_CHARS.toLocaleString("en-US")} chars) asked for a full digest plus answers to the 25 QA questions. Scored with the same recall judge and checklist as gist, and the same correctness judge as the RAG suite. One run only.`,
    n: `${chk.length} checklist items, ${qa.length} questions; ${included}/${all.length} source blocks fit`,
    metrics: {
      checklist_recall: pct(rec.filter((r) => r.j.found).length, chk.length), qa_answer_correctness: r3(mean(cor)),
      input_tokens: meta.input_tokens, output_tokens: meta.output_tokens, cost_usd: r3(cost * 1000) / 1000, latency_s: r3(secs),
      blocks_included: included, blocks_total: all.length,
    },
    tables: [
      { title: "Baseline recall by category", columns: ["category", "found", "total"], rows: cats.map((c) => { const xs = rec.filter((r) => r.it.category === c); return [c, xs.filter((x) => x.j.found).length, xs.length]; }) },
      { title: "Baseline misses", columns: ["id", "finding"], rows: rec.filter((r) => !r.j.found).map((r) => [r.it.id, r.it.description]) },
    ],
  };
}

// ======================================================================================
const SUITES: Record<string, (m: number) => Promise<Suite | Suite[]>> = {
  fact_recall: suiteFactRecall, citation_precision: suiteCitation, verifier_jev: suiteVerifier, contradictions: suiteContradictions,
  rag: suiteRag, needle: suiteNeedle, agent: suiteAgent, memory: suiteMemory, cost_latency: suiteCost, baseline: (m) => suiteBaseline(m),
};
const ORDER = ["fact_recall", "citation_precision", "verifier_jev", "contradictions", "rag", "retrieval_ablation", "needle", "agent", "memory", "cost_latency", "baseline"];

async function merge() {
  const files = fs.readdirSync(SUITE_DIR).filter((f) => /^[a-z_]+\.json$/.test(f));
  const suites = files.map((f) => JSON.parse(fs.readFileSync(path.join(SUITE_DIR, f), "utf8")) as Suite & { matter_id: number; matter_label: string; generated_at: string });
  suites.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const first = suites[0];
  const out = {
    generated_at: new Date().toISOString(), matter_id: first?.matter_id ?? null, matter_label: first?.matter_label ?? null,
    judge_model: JUDGE_MODEL,
    total_eval_cost_usd: r3(suites.reduce((s, x) => s + (x.cost_usd ?? 0), 0) * 1000) / 1000,
    note: "Adaptations of published benchmarks on one real matter. Not official leaderboard numbers. Reproduce: bun run job scripts/eval.ts --suites <ids>; bun run job scripts/eval.ts --merge",
    suites,
  };
  const ts = out.generated_at.replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(OUT, `${ts}.json`), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(out, null, 2));
  console.log(`wrote latest.json with ${suites.length} suites, eval cost $${out.total_eval_cost_usd}`);
}

async function main() {
  fs.mkdirSync(SUITE_DIR, { recursive: true });
  if (process.argv.includes("--merge")) return merge();
  const i = process.argv.indexOf("--suites");
  const want = i >= 0 ? process.argv[i + 1].split(",") : Object.keys(SUITES);
  const matter = await pickMatter();
  for (const id of want) {
    const fn = SUITES[id];
    if (!fn) { console.error(`unknown suite ${id}`); continue; }
    const c0 = evalCost, t0 = Date.now();
    try {
      const r = await fn(matter.id);
      const list = Array.isArray(r) ? r : [r];
      const each = (evalCost - c0) / list.length;
      for (const s of list) {
        const rec = { ...s, cost_usd: r3(each * 10000) / 10000, secs: s.secs ?? r3((Date.now() - t0) / 1000), matter_id: matter.id, matter_label: matter.label, generated_at: new Date().toISOString() };
        fs.writeFileSync(path.join(SUITE_DIR, `${s.id}.json`), JSON.stringify(rec, null, 2));
        console.log(`[${s.id}] ${JSON.stringify(s.metrics)} judge+baseline cost $${r3(each * 1000) / 1000}`);
      }
    } catch (e) {
      console.error(`[${id}] failed:`, e);
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
