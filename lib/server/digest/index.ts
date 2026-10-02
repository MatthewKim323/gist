import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { structured } from "../llm";
import type { RunCtx } from "../pipeline/ctx";
import type { Citation, Contradiction, Digest, Fact, GateItem, Phase } from "@/lib/types";
import { computeSignals, markViewed, sinceLastOpened, type Signals, type MatterData } from "../signals";

export { markViewed } from "../signals";

type Sig = Signals & { data: MatterData };

const NO_DASH = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

function humanize(k: string): string {
  return k.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
}

async function loadGates(matterId: number, sig: Sig): Promise<GateItem[]> {
  const { data } = await db().from("gate_items").select("*").eq("matter_id", matterId);
  const order = ["Intake", "Treatment", "Demand", "Negotiation", "Litigation", "Trial", "Disbursement", "Closed"];
  const cur = order.findIndex((p) => p.toLowerCase() === sig.stage.toLowerCase());
  const rank = { missing: 0, conflicting: 1, partial: 2, have: 3 } as Record<string, number>;
  return (data ?? [])
    .map((g): GateItem => {
      const cid = g.owed_by_contact_id != null ? Number(g.owed_by_contact_id) : null;
      const s = cid != null ? sig.comm.get(cid) : undefined;
      return {
        requirement_key: g.requirement_key, phase: g.phase as Phase, label: g.label, status: g.status,
        owed_by: g.owed_by, owed_by_contact_id: cid,
        owed_by_name: cid != null ? sig.contacts.get(cid)?.name ?? null : null,
        due_date: g.due_date,
        days_outstanding: g.status !== "have" && s?.unanswered[0] ? Math.max(0, Math.round((Date.parse(sig.today) - Date.parse(s.unanswered[0].date)) / 86_400_000)) : null,
        evidence: ((g.evidence ?? []) as Citation[]).map((e) => ({ ...e, label: e.label ?? sig.label(e.source_ref) })),
        note: g.note, confidence: g.confidence,
      };
    })
    // current phase: everything; earlier phases: only what is still unmet
    .filter((g) => {
      const i = order.indexOf(g.phase);
      return i === cur || (i < cur && g.status !== "have") || cur < 0;
    })
    .sort((a, b) => order.indexOf(b.phase) - order.indexOf(a.phase) || rank[a.status] - rank[b.status]);
}

async function loadRedFlags(matterId: number, sig: Sig): Promise<Contradiction[]> {
  const { data } = await db().from("contradictions").select("*").eq("matter_id", matterId).order("created_at", { ascending: false });
  const sev = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  return (data ?? []).map((c) => ({
    id: c.id, title: c.title, why_it_matters: c.why_it_matters ?? "", severity: c.severity ?? "medium",
    claims: ((c.claims ?? []) as { source_ref: string; says: string; quote: string; date?: string | null }[])
      .map((x) => ({ source_ref: x.source_ref, says: x.says, quote: x.quote, date: x.date ?? null, label: sig.label(x.source_ref) })),
  })).sort((a, b) => (sev[a.severity] ?? 1) - (sev[b.severity] ?? 1));
}

function injuries(facts: Fact[], sig: Sig): Digest["injuries"] {
  const groups = new Map<string, Fact[]>();
  for (const f of facts) {
    const k = f.event_key ?? "";
    if (!(f.kind === "injury" || k.startsWith("injury."))) continue;
    const key = k.startsWith("injury.") ? k.split(".").slice(0, 2).join(".") : `injury.${f.id}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }
  return [...groups.entries()]
    .map(([key, fs]) => {
      fs.sort((a, b) => b.importance - a.importance || (a.source_ref.startsWith("doc:") ? -1 : 1));
      const part = key.startsWith("injury.") && !/^injury\.[0-9a-f-]{36}$/.test(key) ? humanize(key.slice(7)) : null;
      const seen = new Set<string>();
      const cites = fs.filter((f) => !seen.has(f.source_ref) && seen.add(f.source_ref)).slice(0, 6)
        .map((f) => ({ source_ref: f.source_ref, quote: f.quote, label: sig.label(f.source_ref) }));
      return { label: fs[0].summary, body_part: part, cites, _imp: Math.max(...fs.map((f) => f.importance)) };
    })
    .sort((a, b) => b._imp - a._imp)
    .map(({ _imp, ...rest }) => { void _imp; return rest; });
}

async function cost(matterId: number): Promise<Digest["cost"]> {
  const rows: { run_id: string | null; model: string; cost_usd: number; created_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db().from("llm_calls").select("run_id,model,cost_usd,created_at").eq("matter_id", matterId).order("id").range(from, from + 999);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const { data: run } = await db().from("agent_runs").select("id").eq("matter_id", matterId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const total = rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const last = run ? rows.filter((r) => r.run_id === run.id).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0) : 0;
  return { cold_usd: Math.round(total * 10000) / 10000, last_run_usd: Math.round(last * 10000) / 10000, models: [...new Set(rows.map((r) => r.model))] };
}

async function photoUrl(matterId: number, path: string | null): Promise<string | null> {
  return path ? `/api/docs/photo/${matterId}` : null;
}

/** Everything except the story. Deterministic + stored pipeline outputs. */
export async function assemble(matterId: number, story: Digest["story"] = [], preSig?: Sig): Promise<{ digest: Digest; sig: Sig }> {
  const sig = preSig ?? (await computeSignals(matterId));
  const m = sig.data.matter;
  const raw = (m.raw ?? {}) as Record<string, { name?: string } | undefined>;
  const [gates, red_flags, c, photo] = await Promise.all([loadGates(matterId, sig), loadRedFlags(matterId, sig), cost(matterId), photoUrl(m.id, m.photo_path)]);
  const top_facts = [...sig.data.facts]
    .sort((a, b) => b.importance - a.importance || (b.event_date ?? "").localeCompare(a.event_date ?? ""))
    .slice(0, 12);

  const digest: Digest = {
    matter: {
      id: m.id, display_number: m.display_number ?? String(m.id), client_name: m.client_name ?? "",
      photo_url: photo, incident_date: sig.incident_date, days_since_incident: sig.days_since_incident,
      stage: sig.stage, stage_since: sig.stage_since,
      responsible_attorney: raw.responsible_attorney?.name ?? null,
      clio_url: `${env.clioBase()}/nc/#/matters/${m.id}`,
      sol: sig.sol,
      open_date: m.open_date,
    },
    money: {
      case_value: sig.money.case_value, coverage_limit: sig.money.coverage_limit, coverage_state: sig.money.coverage_state,
      coverage_notes: sig.money.coverage_notes, underwater: sig.money.underwater, specials: sig.money.specials,
      liens: sig.money.liens, firm_spend: sig.money.firm_spend,
      wage_loss: sig.money.wage_loss, gap_usd: sig.money.gap_usd, limit_pct_of_value: sig.money.limit_pct_of_value,
      coverage_lines: sig.money.coverage_lines, expense_count: sig.money.expense_count,
    },
    story,
    phase: { current: sig.stage, next: sig.next_stage, time_in_stage_days: sig.time_in_stage_days, gates },
    red_flags,
    actions: sig.actions,
    last_client_contact: sig.last_client_contact,
    last_client_contact_detail: { channel: sig.last_client_contact_channel, days_ago: sig.last_client_contact_days, last_written_from_client: sig.last_written_from_client },
    since_last_opened: { at: null, items: [] },
    injuries: injuries(sig.data.facts, sig),
    providers: sig.providers,
    top_facts,
    completeness: sig.completeness,
    cost: c,
    generated_at: new Date().toISOString(),
  };
  return { digest, sig };
}

// ---------------- story ----------------
const StoryOut = z.object({
  bullets: z.array(z.object({ text: z.string(), cites: z.array(z.string()) })),
});

const STORY_SYSTEM = `You write the 5-bullet "story so far" an attorney reads before touching a New York personal-injury file.
Use ONLY the facts and signals given. Every bullet must cite 1-4 refs copied exactly from the [ref] tags.
Bullets, in order: (1) what happened and when; (2) injuries and treatment, including what is still unresolved; (3) where the case is procedurally and what is holding it up; (4) money: value vs coverage, specials, liens, using only the numbers given; (5) the biggest risk or contradiction in the file.
Each bullet: one or two plain sentences, specific (dates, names, amounts from the input), no hedging filler, no legal advice, no em dashes. Never invent a number or date.`;

function signalLines(sig: Sig): string[] {
  const L: string[] = [];
  const r = (c: Citation[] | undefined) => (c && c[0] ? `[${c[0].source_ref}]` : "[signal]");
  if (sig.incident_date) L.push(`${r(sig.incident_date.cites)} Incident date ${sig.incident_date.value} (${sig.days_since_incident} days ago).`);
  L.push(`[signal] Stage: ${sig.stage}${sig.next_stage ? `, next ${sig.next_stage}` : ""}.`);
  if (sig.sol) L.push(`${r(sig.sol.date.cites.filter((c) => !c.source_ref.startsWith("matter:")))} Statute of limitations ${sig.sol.date.value}${sig.sol.satisfied ? " (task marked complete)" : ""}.`);
  const mo = sig.money;
  if (mo.case_value) L.push(`${r(mo.case_value.cites)} Estimated case value $${mo.case_value.value.toLocaleString("en-US")}.`);
  if (mo.coverage_limit) L.push(`${r(mo.coverage_limit.cites)} Adverse BI limit $${mo.coverage_limit.value.toLocaleString("en-US")} per person; coverage state ${mo.coverage_state}${mo.underwater ? `; value exceeds the limit by $${mo.gap_usd?.toLocaleString("en-US")} (limit is ${mo.limit_pct_of_value}% of value)` : ""}.`);
  if (mo.specials) L.push(`${r(mo.specials.cites)} Medical specials to date $${mo.specials.value.toLocaleString("en-US")}.`);
  if (mo.wage_loss) L.push(`${r(mo.wage_loss.cites)} Wage loss claimed $${mo.wage_loss.value.toLocaleString("en-US")}.`);
  for (const l of mo.liens) L.push(`${r(l.cites)} Lien $${l.value.toLocaleString("en-US")}.`);
  L.push(`${r(mo.firm_spend.cites)} Firm case costs to date $${mo.firm_spend.value.toLocaleString("en-US")}.`);
  for (const a of sig.actions.filter((x) => x.bucket !== "upcoming").slice(0, 8)) {
    L.push(`[${a.cite.source_ref}] ${a.bucket === "overdue" ? `Overdue ${a.days} days` : `Waiting ${a.days} days`}: ${a.label}${a.owner ? ` (on ${a.owner}${a.owner_name ? `, ${a.owner_name}` : ""})` : ""}.`);
  }
  if (sig.last_client_contact) L.push(`${r(sig.last_client_contact.cites)} Last client contact ${sig.last_client_contact.value} by ${sig.last_client_contact_channel} (${sig.last_client_contact_days} days ago).`);
  return L;
}

function storyInput(sig: Sig, flags: Contradiction[], gates: GateItem[]): { text: string; refs: Set<string> } {
  const facts = [...sig.data.facts].sort((a, b) => b.importance - a.importance || (a.event_date ?? "").localeCompare(b.event_date ?? "")).slice(0, 140)
    .sort((a, b) => (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999"));
  const lines = [
    "SIGNALS (computed from Clio, exact)", ...signalLines(sig), "",
    "VERIFIED FACTS (chronological)",
    ...facts.map((f) => `[${f.source_ref}] ${f.event_date ?? "undated"} ${f.kind}${f.event_key ? `/${f.event_key}` : ""}${f.amount_usd != null ? ` $${Number(f.amount_usd).toLocaleString("en-US")}` : ""}: ${f.summary}`),
  ];
  if (flags.length) {
    lines.push("", "CONTRADICTIONS");
    for (const c of flags.slice(0, 8)) lines.push(`${c.claims.map((x) => `[${x.source_ref}]`).join("")} (${c.severity}) ${c.title}: ${c.why_it_matters}`);
  }
  const open = gates.filter((g) => g.status !== "have").slice(0, 12);
  if (open.length) {
    lines.push("", "OPEN GATE ITEMS");
    for (const g of open) lines.push(`${g.evidence[0] ? `[${g.evidence[0].source_ref}]` : "[signal]"} ${g.label}: ${g.status}${g.owed_by ? `, owed by ${g.owed_by}${g.owed_by_name ? ` (${g.owed_by_name})` : ""}` : ""}`);
  }
  const text = lines.join("\n");
  const refs = new Set([...text.matchAll(/\[([a-z_]+:[^\]\s]+)\]/g)].map((m) => m[1]));
  return { text, refs };
}

async function writeStory(ctx: RunCtx | null, matterId: number, sig: Sig, flags: Contradiction[], gates: GateItem[]): Promise<{ story: Digest["story"]; hash: string; model: string | null }> {
  const { text, refs } = storyInput(sig, flags, gates);
  const model = env.synthModel();
  const hash = createHash("sha256").update(`${model}\n${STORY_SYSTEM}\n${text}`).digest("hex");
  const { data: prev } = await db().from("digests").select("input_hash,json,model").eq("matter_id", matterId).order("version", { ascending: false }).limit(1).maybeSingle();
  const prevStory = (prev?.json as Digest | undefined)?.story;
  if (prev && prev.input_hash === hash && prevStory?.length) return { story: prevStory, hash, model: prev.model ?? model };
  if (sig.data.facts.length === 0) return { story: [], hash, model: null };

  const run = async (t?: { usage: (u: { input?: number; output?: number; cost?: number }) => void }) => {
    const { data, usage } = await structured({
      model, system: STORY_SYSTEM, schema: StoryOut, schemaName: "story",
      input: text, meta: { purpose: "synth.story", matterId, runId: ctx?.runId ?? null }, reasoning: "medium",
    });
    t?.usage({ input: usage.input, output: usage.output, cost: usage.cost });
    return data;
  };
  let out: z.infer<typeof StoryOut>;
  try {
    out = ctx ? await ctx.task("synth", "story", (t) => run(t)) : await run();
  } catch {
    // keep the last good story rather than blanking the dashboard; new hash so the next build retries
    return { story: prevStory ?? [], hash: `${hash}:failed`, model: null };
  }
  const story = out.bullets
    .map((b) => {
      const cites = [...new Set(b.cites.map((c) => c.replace(/^\[|\]$/g, "").trim()))].filter((c) => refs.has(c));
      return { text: NO_DASH(b.text.trim()), cites: cites.map((c) => ({ source_ref: c, label: sig.label(c) })) };
    })
    .filter((b) => b.text && b.cites.length > 0)
    .slice(0, 5);
  return { story, hash, model };
}

async function save(matterId: number, digest: Digest, hash: string, model: string | null): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: prev } = await db().from("digests").select("version").eq("matter_id", matterId).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (prev?.version ?? 0) + 1;
    const { error } = await db().from("digests").insert({ matter_id: matterId, version, input_hash: hash, json: digest, model });
    if (!error) return version;
    if (!/duplicate|unique/i.test(error.message)) throw new Error(`save digest: ${error.message}`);
  }
  throw new Error("save digest: version race");
}

/** Pipeline stage 7: signals + gates + contradictions + facts + story, saved as a new digest version. */
export async function buildDigest(ctx: RunCtx): Promise<{ digest: Digest; version: number }> {
  const { digest, sig } = await assemble(ctx.matterId);
  const { story, hash, model } = await writeStory(ctx, ctx.matterId, sig, digest.red_flags, digest.phase.gates);
  digest.story = story;
  const version = await save(ctx.matterId, digest, hash, model);
  return { digest, version };
}

/** Same as buildDigest without a pipeline run (scripts, API refresh). */
export async function rebuildDigest(matterId: number): Promise<{ digest: Digest; version: number }> {
  const { digest, sig } = await assemble(matterId);
  const { story, hash, model } = await writeStory(null, matterId, sig, digest.red_flags, digest.phase.gates);
  digest.story = story;
  const version = await save(matterId, digest, hash, model);
  return { digest, version };
}

/**
 * Latest saved digest for the dashboard, with since_last_opened computed for this viewer.
 * If no digest has been built yet, returns a live deterministic one (no story) so the page is never empty.
 */
export async function getDigest(matterId: number, viewer: string | null): Promise<{ digest: Digest; version: number | null; live: boolean }> {
  const { data: row } = await db().from("digests").select("version,json").eq("matter_id", matterId).order("version", { ascending: false }).limit(1).maybeSingle();
  let digest: Digest;
  let version: number | null = null;
  let live = false;
  let sig: Sig | undefined;
  if (row) {
    digest = row.json as Digest;
    version = row.version as number;
  } else {
    const a = await assemble(matterId);
    digest = a.digest; sig = a.sig; live = true;
  }
  if (viewer) {
    const s = sig ?? (await computeSignals(matterId));
    digest.since_last_opened = await sinceLastOpened(matterId, viewer, s.data, s.label);
  }
  return { digest, version, live };
}
