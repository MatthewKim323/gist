import "server-only";
// Read-only, matter-scoped tools for the Ask gist assistant. Every tool returns compact text where each
// claim carries its [ref], and registers those refs (with label + quote) so the answer can only cite them.
import { db } from "../db";
import { getDigest } from "../digest";
import { listActions } from "../actions";
import { signalsFor } from "../radar";
import { search } from "../retrieval/search";
import { bestSnippet } from "../retrieval/ask";
import type { Citation, Digest } from "@/lib/types";
import { recallMemories, saveMemory, type MemoryKind } from "./memory";
import { nextMoves, type Move } from "../moves";

export interface RefMeta { label?: string; quote?: string }

export interface ToolCtx {
  matterId: number;
  profileId: string;
  viewer: string | null;
  refs: Map<string, RefMeta>;
  digest?: Digest;
  /** memories written this turn by the remember tool, surfaced to the UI */
  remembered: string[];
  /** next moves fetched this turn (get_next_moves); the dock renders the top ones as action cards */
  moves?: Move[];
}

const MAX_OUT = 7000;
const clip = (s: string, n = MAX_OUT) => (s.length > n ? `${s.slice(0, n)}\n(truncated)` : s);
const usd = (n: number | null | undefined) => (n == null ? "unknown" : `$${Math.round(n).toLocaleString("en-US")}`);

function reg(ctx: ToolCtx, cites: Citation[] | undefined | null): string {
  if (!cites?.length) return "";
  const out: string[] = [];
  for (const c of cites.slice(0, 4)) {
    if (!c?.source_ref) continue;
    const prev = ctx.refs.get(c.source_ref);
    ctx.refs.set(c.source_ref, { label: prev?.label ?? c.label, quote: prev?.quote ?? c.quote });
    out.push(c.source_ref);
  }
  return out.length ? ` [${out.join(", ")}]` : "";
}

async function digestOf(ctx: ToolCtx): Promise<Digest> {
  if (!ctx.digest) ctx.digest = (await getDigest(ctx.matterId, ctx.viewer)).digest;
  return ctx.digest;
}

async function overview(ctx: ToolCtx): Promise<string> {
  const d = await digestOf(ctx);
  const m = d.matter;
  const L: string[] = [];
  L.push(`Case: ${m.client_name} (${m.display_number}). Stage: ${m.stage}${m.stage_since ? ` since ${m.stage_since}` : ""}. Next phase: ${d.phase.next ?? "none"}.`);
  if (m.incident_date) L.push(`Incident: ${m.incident_date.value}${reg(ctx, m.incident_date.cites)} (${m.days_since_incident ?? "?"} days ago).`);
  if (m.sol) L.push(`Statute of limitations: ${m.sol.date.value}${reg(ctx, m.sol.date.cites)}, ${m.sol.days_remaining} days remaining${m.sol.satisfied ? " (satisfied)" : ""}.`);
  if (m.responsible_attorney) L.push(`Responsible attorney: ${m.responsible_attorney}.`);
  L.push("", "Story:");
  for (const s of d.story ?? []) L.push(`- ${s.text}${reg(ctx, s.cites)}`);
  L.push("", money(ctx, d));
  if (d.last_client_contact) L.push(`Last client contact: ${d.last_client_contact.value}${reg(ctx, d.last_client_contact.cites)}.`);
  const since = d.since_last_opened;
  L.push("", `Since this user last opened the case${since.at ? ` (${since.at})` : ""}: ${since.items.length ? "" : "nothing new recorded."}`);
  for (const it of since.items.slice(0, 12)) L.push(`- ${it.kind}: ${it.label}${reg(ctx, [it.cite])}`);
  const c = d.completeness;
  L.push("", `Coverage of the file: ${c.entries_read}/${c.entries_total} entries, ${c.pages_read}/${c.pages_total} pages read; ${c.facts_verified} verified facts.`);
  return L.join("\n");
}

function money(ctx: ToolCtx, d: Digest): string {
  const $ = d.money;
  const L = ["Money:"];
  L.push(`- Case value: ${usd($.case_value?.value)}${reg(ctx, $.case_value?.cites)}`);
  L.push(`- Coverage limit: ${usd($.coverage_limit?.value)}${reg(ctx, $.coverage_limit?.cites)} (coverage ${$.coverage_state})${$.underwater ? ", UNDERWATER (value exceeds limit)" : ""}`);
  for (const l of $.coverage_lines ?? []) L.push(`  - ${l.label}: per person ${usd(l.per_person)}, per occurrence ${usd(l.per_occurrence)}`);
  for (const n of $.coverage_notes ?? []) L.push(`  - note: ${n.value}${reg(ctx, n.cites)}`);
  L.push(`- Medical specials: ${usd($.specials?.value)}${reg(ctx, $.specials?.cites)}`);
  if ($.wage_loss) L.push(`- Wage loss: ${usd($.wage_loss.value)}${reg(ctx, $.wage_loss.cites)}`);
  for (const l of $.liens ?? []) L.push(`- Lien: ${usd(l.value)}${reg(ctx, l.cites)}`);
  L.push(`- Firm spend: ${usd($.firm_spend?.value)}${reg(ctx, $.firm_spend?.cites)}`);
  if ($.gap_usd != null) L.push(`- Gap (value minus per-person limit): ${usd($.gap_usd)}`);
  return L.join("\n");
}

async function phase(ctx: ToolCtx): Promise<string> {
  const d = await digestOf(ctx);
  const L = [`Current phase: ${d.phase.current}. Next: ${d.phase.next ?? "none"}. Time in stage: ${d.phase.time_in_stage_days ?? "?"} days.`, "Gate checklist to reach the next phase:"];
  for (const g of d.phase.gates) {
    const who = g.owed_by ? `owed by ${g.owed_by}${g.owed_by_name ? ` (${g.owed_by_name})` : ""}` : "";
    const days = g.days_outstanding != null ? `${g.days_outstanding} days outstanding` : "";
    L.push(`- [${g.status.toUpperCase()}] ${g.label} (phase ${g.phase}) ${[who, days, g.due_date ? `due ${g.due_date}` : ""].filter(Boolean).join(", ")}${g.note ? `. Note: ${g.note}` : ""}${reg(ctx, g.evidence)}`);
  }
  return L.join("\n");
}

async function nextActions(ctx: ToolCtx): Promise<string> {
  const d = await digestOf(ctx);
  const L: string[] = ["Action items (from the case file):"];
  const order = { overdue: 0, upcoming: 1, waiting: 2 } as const;
  for (const a of [...d.actions].sort((x, y) => order[x.bucket] - order[y.bucket])) {
    const days = a.days == null ? "" : a.bucket === "overdue" ? `, ${a.days} days overdue` : a.bucket === "upcoming" ? `, due in ${a.days} days` : `, waiting ${a.days} days`;
    L.push(`- ${a.bucket.toUpperCase()}: ${a.label}${a.owner ? ` (owner: ${a.owner}${a.owner_name ? `, ${a.owner_name}` : ""})` : ""}${a.due_date ? `, due ${a.due_date}` : ""}${days}${reg(ctx, [a.cite])}`);
  }
  try {
    const drafts = (await listActions(ctx.matterId)).filter((a) => a.status === "proposed" || a.status === "approved");
    L.push("", `Agent drafts ready for review (${drafts.length}):`);
    for (const a of drafts.slice(0, 10)) L.push(`- ${a.status}: ${a.channel} to ${a.recipient_name ?? "unknown"}: "${a.subject}"${a.rationale ? `. Why: ${a.rationale}` : ""}${reg(ctx, a.cites)}`);
  } catch { L.push("", "Agent drafts: unavailable."); }
  const sig = signalsFor(d);
  L.push("", `Radar signals for this case (${sig.length}):`);
  for (const s of sig) L.push(`- ${s.severity.toUpperCase()} ${s.kind}: ${s.headline}. ${s.detail}${s.cite ? reg(ctx, [s.cite]) : ""}`);
  return L.join("\n");
}

async function moves(ctx: ToolCtx): Promise<string> {
  const r = await nextMoves(ctx.matterId, await digestOf(ctx));
  const live = r.moves.filter((m) => m.status === "todo" || m.status === "in_progress");
  ctx.moves = live;
  const L = [`Next moves to get ${r.client} to ${r.next_phase ?? "the next phase"} (${r.gates_have} of ${r.gates_total} gate items in hand, ${r.done} moves done). Ranked; the user sees these as action cards with a button that does each one:`];
  for (const m of live) L.push(`${m.priority}. ${m.title}: ${m.why}${m.unblocks ? `; ${m.unblocks}` : ""}${m.status === "in_progress" ? " (in progress)" : ""}${reg(ctx, m.cites)}`);
  if (!live.length) L.push("Nothing open.");
  return L.join("\n");
}

async function redFlags(ctx: ToolCtx): Promise<string> {
  const d = await digestOf(ctx);
  if (!d.red_flags.length) return "No red flags (contradictions) found in the file.";
  const L = ["Red flags (contradictions across sources):"];
  for (const f of d.red_flags) {
    L.push(`- [${f.severity}] ${f.title}. Why it matters: ${f.why_it_matters}`);
    for (const c of f.claims) L.push(`  - ${c.date ?? "undated"}: says "${c.says}"${reg(ctx, [{ source_ref: c.source_ref, label: c.label, quote: c.quote }])}`);
  }
  return L.join("\n");
}

async function treatment(ctx: ToolCtx): Promise<string> {
  const d = await digestOf(ctx);
  const L = ["Injuries:"];
  for (const i of d.injuries) L.push(`- ${i.label}${i.body_part ? ` (${i.body_part})` : ""}${reg(ctx, i.cites)}`);
  L.push("", "Providers (treatment lanes):");
  for (const p of d.providers) {
    L.push(`- ${p.name}${p.role ? ` (${p.role})` : ""}: ${p.visits.length} visits, ${p.first_visit ?? "?"} to ${p.last_visit ?? "?"}; last heard from ${p.last_heard_from ?? "unknown"}; ${p.open_asks} open asks${p.billed ? `; billed ${usd(p.billed.value)}${reg(ctx, p.billed.cites)}` : ""}${reg(ctx, p.visits.slice(-2).map((v) => v.cite))}`);
    for (const g of p.gaps) L.push(`  - treatment gap ${g.from} to ${g.to} (${g.days} days)`);
  }
  return L.join("\n");
}

async function searchCase(ctx: ToolCtx, q: string): Promise<string> {
  if (!q?.trim()) return "Empty query.";
  const kinds = ["note", "email", "call", "task", "calendar", "expense", "field", "contact", "relationship", "doc", "fact"];
  const hits = await search(ctx.matterId, q.slice(0, 400), { k: 8, kinds });
  if (!hits.length) return `No passages matched "${q}".`;
  return hits.map((h) => {
    if (!ctx.refs.has(h.cite)) ctx.refs.set(h.cite, { quote: bestSnippet(h.body, q) });
    return `[${h.cite}] ${h.header}${h.event_date ? ` (${h.event_date})` : ""}\n${h.body.slice(0, 900)}`;
  }).join("\n\n");
}

async function getSource(ctx: ToolCtx, ref: string): Promise<string> {
  const r = String(ref ?? "").trim().replace(/^\[|\]$/g, "");
  const doc = r.match(/^(?:doc|document):(\d+)(?:#p(\d+))?$/);
  if (doc) {
    const d = await db().from("documents").select("clio_id,name,filename,version_id,page_count").eq("clio_id", Number(doc[1])).eq("matter_id", ctx.matterId).maybeSingle();
    if (!d.data) return `No document ${r} on this matter.`;
    const page = doc[2] ? Number(doc[2]) : 1;
    const p = await db().from("doc_pages").select("text").eq("doc_id", Number(doc[1])).eq("version_id", d.data.version_id ?? 0).eq("page", page).maybeSingle();
    const cite = `doc:${doc[1]}#p${page}`;
    ctx.refs.set(cite, ctx.refs.get(cite) ?? {});
    return `[${cite}] ${d.data.name ?? d.data.filename} page ${page} of ${d.data.page_count ?? "?"}\n${clip(p.data?.text ?? "(no text for this page)", 5000)}`;
  }
  if (r.startsWith("fact:")) {
    const f = await db().from("facts").select("summary,quote,source_ref,event_date").eq("id", r.slice(5)).eq("matter_id", ctx.matterId).maybeSingle();
    if (!f.data) return `No fact ${r}.`;
    ctx.refs.set(r, ctx.refs.get(r) ?? { quote: f.data.quote });
    return `[${r}] ${f.data.event_date ?? "undated"}: ${f.data.summary}\nQuote: "${f.data.quote}" (from ${f.data.source_ref})`;
  }
  const it = await db().from("source_items").select("id,kind,title,body_text,occurred_at").eq("matter_id", ctx.matterId).eq("id", r).maybeSingle();
  if (!it.data) return `No source ${r} on this matter.`;
  ctx.refs.set(r, ctx.refs.get(r) ?? {});
  return `[${r}] ${it.data.kind} ${it.data.occurred_at ?? ""} ${it.data.title ?? ""}\n${clip(it.data.body_text ?? "", 5000)}`;
}

// ---------------- registry ----------------

type Args = Record<string, unknown>;
interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (ctx: ToolCtx, a: Args) => Promise<string>;
  activity: (a: Args) => string;
}

const none = { type: "object", properties: {}, additionalProperties: false };

export const TOOLS: ToolDef[] = [
  { name: "get_next_moves", description: "The ranked next moves for this case: what to do now to reach the next phase, each an executable action card (chase a provider's records with a ready draft, follow up with the client or defense, share status with a provider, review an upload, prep red flags, policy-limits demand). Use first for any \"what do I do / what next / where do I start\" question.", parameters: none, run: (c) => moves(c), activity: () => "ranked the next moves" },
  { name: "get_overview", description: "Case snapshot: client, stage, incident date, statute of limitations, the cited story, money summary, last client contact, and what changed since the user last opened the case.", parameters: none, run: (c) => overview(c), activity: () => "read the case overview" },
  { name: "get_money", description: "Money: case value, coverage limits and lines, specials, liens, wage loss, firm spend, the gap.", parameters: none, run: async (c) => money(c, await digestOf(c)), activity: () => "checked the money" },
  { name: "get_phase_checklist", description: "Current phase, next phase, and every gate requirement to get there with status (have/partial/missing/conflicting), who owes it, and days outstanding.", parameters: none, run: (c) => phase(c), activity: () => "checked the phase gates" },
  { name: "get_next_actions", description: "Overdue, upcoming and waiting action items, agent drafts ready for review, and radar signals (SOL, policy limits, client silence, stalled phase, treatment gaps) for this case.", parameters: none, run: (c) => nextActions(c), activity: () => "pulled next actions, drafts and radar" },
  { name: "get_red_flags", description: "Contradictions between sources (what each source says, with dates) and why each matters.", parameters: none, run: (c) => redFlags(c), activity: () => "reviewed the red flags" },
  { name: "get_treatment", description: "Injuries and treating providers: visits, date ranges, treatment gaps, billing, last heard from, open asks.", parameters: none, run: (c) => treatment(c), activity: () => "looked at treatment and providers" },
  {
    name: "search_case", description: "Hybrid search (keyword + semantic) over everything in the case file: notes, emails, calls, tasks, medical records and other document pages, verified facts. Use for any specific detail.",
    parameters: { type: "object", properties: { q: { type: "string", description: "what to look for" } }, required: ["q"], additionalProperties: false },
    run: (c, a) => searchCase(c, String(a.q ?? "")), activity: (a) => `searched the case for "${String(a.q ?? "").slice(0, 60)}"`,
  },
  {
    name: "get_source", description: "Full text of one source by its ref, e.g. email:88, note:12, doc:45#p17, fact:<id>.",
    parameters: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"], additionalProperties: false },
    run: (c, a) => getSource(c, String(a.ref ?? "")), activity: (a) => `opened ${String(a.ref ?? "")}`,
  },
  {
    name: "recall_memory", description: "Search what you remember about this user (their focus, preferences, people they track) across cases.",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false },
    run: async (c, a) => {
      const ms = await recallMemories(c.profileId, String(a.q ?? ""), c.matterId, 6);
      return ms.length ? ms.map((m) => `- (${m.kind}) ${m.text}`).join("\n") : "Nothing remembered yet.";
    },
    activity: () => "checked memory",
  },
  {
    name: "remember", description: "Save a durable note about this user when they ask you to remember something or state a lasting preference/focus.",
    parameters: { type: "object", properties: { text: { type: "string" }, kind: { type: "string", enum: ["preference", "focus", "fact", "relationship"] } }, required: ["text", "kind"], additionalProperties: false },
    run: async (c, a) => {
      const text = String(a.text ?? "").slice(0, 300);
      if (!text) return "Nothing to remember.";
      await saveMemory(c.profileId, { kind: (a.kind as MemoryKind) ?? "fact", text, importance: 4, matterId: c.matterId });
      c.remembered.push(text);
      return `Saved: ${text}`;
    },
    activity: () => "saved a memory",
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Which tool shows what the user is looking at, per dashboard tab. */
export const TAB_INFO: Record<string, { label: string; tool: string | null }> = {
  overview: { label: "Overview", tool: "get_overview" },
  phase: { label: "Phase & gates", tool: "get_phase_checklist" },
  money: { label: "Money", tool: "get_money" },
  flags: { label: "Red flags", tool: "get_red_flags" },
  actions: { label: "Next actions", tool: "get_next_actions" },
  drafts: { label: "Agent drafts", tool: "get_next_actions" },
  treatment: { label: "Treatment", tool: "get_treatment" },
  injuries: { label: "Injuries", tool: "get_treatment" },
  providers: { label: "Providers", tool: "get_treatment" },
  inbox: { label: "From providers", tool: null },
  shares: { label: "Shares", tool: null },
  receipt: { label: "Receipt", tool: null },
};

export async function runTool(ctx: ToolCtx, name: string, args: Args): Promise<string> {
  const t = TOOL_BY_NAME.get(name);
  if (!t) return `Unknown tool ${name}.`;
  try { return clip(await t.run(ctx, args)); }
  catch (e) { return `Tool ${name} failed: ${String((e as Error).message).slice(0, 200)}`; }
}
