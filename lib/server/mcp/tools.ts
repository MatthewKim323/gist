import "server-only";
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "../db";
import { getDigest } from "../digest";
import { search } from "../retrieval/search";
import { ask, labelRefs, bestSnippet } from "../retrieval/ask";
import { readSource } from "./source";
import type { Citation, Digest } from "@/lib/types";

// One read-only tool registry for both MCP transports (stdio in mcp/server.ts, Streamable HTTP in
// app/api/mcp/route.ts). Everything reads Supabase. Nothing here writes case data or touches Clio.
// The only side effect anywhere is the cost log row that lib/server/llm.ts writes for embeddings and ask_case.

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const matterId = z.coerce.number().int().positive().describe("Case (matter) id from list_cases");

type Content = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): Content => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const fail = (msg: string): Content => ({ content: [{ type: "text", text: msg }], isError: true });

async function guard(fn: () => Promise<Content>): Promise<Content> {
  try {
    return await fn();
  } catch (e) {
    return fail(`Error: ${(e as Error).message.slice(0, 400)}`);
  }
}

async function matterExists(id: number): Promise<boolean> {
  const { data } = await db().from("matters").select("id").eq("id", id).maybeSingle();
  return !!data;
}

const cites = (cs: Citation[] | undefined, n = 3) =>
  (cs ?? []).slice(0, n).map((c) => ({ ref: c.source_ref, label: c.label ?? c.source_ref, ...(c.quote ? { quote: c.quote.slice(0, 240) } : {}) }));

const usd = (n: number | null | undefined) => (n == null ? null : `$${Math.round(n).toLocaleString("en-US")}`);

/** Compact, lawyer-readable projection of the saved dashboard digest. */
export function compactDigest(d: Digest) {
  const m = d.money;
  const gates = d.phase.gates;
  return {
    case: {
      id: d.matter.id, number: d.matter.display_number, client: d.matter.client_name, demo: !!d.matter.is_demo,
      incident_date: d.matter.incident_date?.value ?? null, days_since_incident: d.matter.days_since_incident,
      responsible_attorney: d.matter.responsible_attorney,
      statute_of_limitations: d.matter.sol ? { date: d.matter.sol.date.value, days_remaining: d.matter.sol.days_remaining, satisfied: d.matter.sol.satisfied } : null,
    },
    story: d.story.map((s) => ({ text: s.text, sources: cites(s.cites, 3) })),
    money: {
      case_value: m.case_value ? { amount: usd(m.case_value.value), sources: cites(m.case_value.cites, 2) } : null,
      coverage_limit: m.coverage_limit ? { amount: usd(m.coverage_limit.value), sources: cites(m.coverage_limit.cites, 2) } : null,
      coverage_state: m.coverage_state,
      underwater: m.underwater,
      gap: usd(m.gap_usd ?? null),
      medical_specials: m.specials ? { amount: usd(m.specials.value), sources: cites(m.specials.cites, 2) } : null,
      liens: m.liens.map((l) => ({ amount: usd(l.value), sources: cites(l.cites, 1) })),
      firm_spend: usd(m.firm_spend?.value),
    },
    phase: {
      current: d.phase.current, next: d.phase.next, days_in_stage: d.phase.time_in_stage_days,
      checklist_counts: {
        have: gates.filter((g) => g.status === "have").length,
        partial: gates.filter((g) => g.status === "partial").length,
        missing: gates.filter((g) => g.status === "missing").length,
        conflicting: gates.filter((g) => g.status === "conflicting").length,
      },
    },
    top_red_flags: d.red_flags.slice(0, 5).map((r) => ({ id: r.id, severity: r.severity, title: r.title, why_it_matters: r.why_it_matters })),
    actions: d.actions.slice(0, 12).map((a) => ({
      label: a.label, bucket: a.bucket, due: a.due_date, days: a.days, owner: a.owner_name ?? a.owner,
      source: { ref: a.cite.source_ref, label: a.cite.label ?? a.cite.source_ref },
    })),
    last_client_contact: d.last_client_contact ? { when: d.last_client_contact.value, sources: cites(d.last_client_contact.cites, 1) } : null,
    injuries: d.injuries.slice(0, 10).map((i) => ({ label: i.label, body_part: i.body_part, sources: cites(i.cites, 2) })),
    generated_at: d.generated_at,
  };
}

async function loadDigest(id: number) {
  if (!(await matterExists(id))) return null;
  // viewer null: no since-last-opened lookup and no view mark, so this stays read-only.
  return (await getDigest(id, null)).digest;
}

export function registerTools(server: McpServer) {
  server.registerTool("list_cases", {
    title: "List cases",
    description:
      "List every case gist has processed: id, case number, client, stage, and whether it is a synthetic demo case. " +
      "Call this first to get the matter_id the other tools need, or when the user names a client and you need their case id.",
    inputSchema: {},
    annotations: RO,
  }, () => guard(async () => {
    const { data, error } = await db().from("matters").select("id,display_number,client_name,description,stage,status,open_date,is_demo")
      .order("is_demo", { ascending: true }).order("open_date", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((m) => m.id);
    const dg = ids.length ? await db().from("digests").select("matter_id,created_at").in("matter_id", ids).order("version", { ascending: false }) : { data: [] };
    const last = new Map<number, string>();
    for (const r of dg.data ?? []) if (!last.has(Number(r.matter_id))) last.set(Number(r.matter_id), r.created_at);
    return ok((data ?? []).map((m) => ({
      matter_id: Number(m.id), number: m.display_number, client: m.client_name, description: m.description,
      stage: m.stage, status: m.status, opened: m.open_date, demo: !!m.is_demo, digest_built_at: last.get(Number(m.id)) ?? null,
    })));
  }));

  server.registerTool("get_digest", {
    title: "Case digest",
    description:
      "The 90-second briefing for one case: the 5-bullet story, money (case value, coverage limit, specials, liens, whether it is underwater), " +
      "current phase and checklist counts, top red flags, overdue / upcoming / waiting actions, last client contact and injuries. " +
      "Every item carries source refs you can open with get_source. Use this whenever the user asks where a case stands or what to do next.",
    inputSchema: { matter_id: matterId },
    annotations: RO,
  }, ({ matter_id }) => guard(async () => {
    const d = await loadDigest(matter_id);
    return d ? ok(compactDigest(d)) : fail(`No case with id ${matter_id}. Call list_cases.`);
  }));

  server.registerTool("get_phase_checklist", {
    title: "Phase checklist",
    description:
      "The have / partial / missing / conflicting checklist of what the case needs to reach its next phase (e.g. Treatment to Demand), " +
      "each row with who owes it, for how many days, and the evidence. Use for 'what are we missing', 'who owes us what', or before drafting a demand.",
    inputSchema: { matter_id: matterId },
    annotations: RO,
  }, ({ matter_id }) => guard(async () => {
    const d = await loadDigest(matter_id);
    if (!d) return fail(`No case with id ${matter_id}. Call list_cases.`);
    return ok({
      current_phase: d.phase.current, next_phase: d.phase.next, days_in_stage: d.phase.time_in_stage_days,
      items: d.phase.gates.map((g) => ({
        key: g.requirement_key, phase: g.phase, item: g.label, status: g.status,
        owed_by: g.owed_by_name ?? g.owed_by, due: g.due_date, days_outstanding: g.days_outstanding,
        note: g.note, evidence: cites(g.evidence, 3),
      })),
    });
  }));

  server.registerTool("get_contradictions", {
    title: "Contradictions (red flags)",
    description:
      "Every place the case file contradicts itself (e.g. the police report vs the client's statement, two different accident dates), " +
      "with severity, why it matters, and each side's quote and source. Use before a deposition, demand, or client call, or when asked about red flags.",
    inputSchema: { matter_id: matterId },
    annotations: RO,
  }, ({ matter_id }) => guard(async () => {
    if (!(await matterExists(matter_id))) return fail(`No case with id ${matter_id}. Call list_cases.`);
    const { data, error } = await db().from("contradictions").select("id,title,why_it_matters,severity,claims").eq("matter_id", matter_id);
    if (error) throw new Error(error.message);
    type Claim = { source_ref: string; says: string; quote: string; date?: string | null };
    const rows = data ?? [];
    const labels = await labelRefs(matter_id, [...new Set(rows.flatMap((c) => ((c.claims ?? []) as Claim[]).map((x) => x.source_ref)))]);
    const sev = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    return ok(rows.map((c) => ({
      id: c.id, severity: c.severity ?? "medium", title: c.title, why_it_matters: c.why_it_matters ?? "",
      claims: ((c.claims ?? []) as Claim[]).map((x) => ({ says: x.says, quote: x.quote, date: x.date ?? null, ref: x.source_ref, label: labels[x.source_ref] ?? x.source_ref })),
    })).sort((a, b) => (sev[a.severity] ?? 1) - (sev[b.severity] ?? 1)));
  }));

  server.registerTool("search_case", {
    title: "Search case file",
    description:
      "Hybrid keyword + semantic search over everything in one case: notes, emails, call logs, tasks, Clio fields, and every OCR'd page of " +
      "medical records, bills and reports. Returns the best passages with a source ref and label. Use to find where something is mentioned " +
      "(e.g. 'left shoulder MRI', 'policy limits', 'missed appointment'), then open the full text with get_source. " +
      "Fast and nearly free. Set expand=true to also search clinical and legal rephrasings (slower, adds one small model call).",
    inputSchema: {
      matter_id: matterId,
      query: z.string().min(1).max(500).describe("What to look for, in plain words"),
      k: z.coerce.number().int().min(1).max(25).optional().describe("Max passages to return (default 8)"),
      expand: z.boolean().optional().describe("Also search model-generated rephrasings (default false)"),
    },
    annotations: RO,
  }, ({ matter_id, query, k, expand }) => guard(async () => {
    if (!(await matterExists(matter_id))) return fail(`No case with id ${matter_id}. Call list_cases.`);
    const hits = await search(matter_id, query, { k: k ?? 8, expand: expand ?? false });
    const factIds = hits.filter((h) => h.cite.startsWith("fact:")).map((h) => h.cite.slice(5));
    const under = new Map<string, string>();
    if (factIds.length) {
      const { data } = await db().from("facts").select("id,source_ref").in("id", factIds);
      for (const f of data ?? []) under.set(`fact:${f.id}`, f.source_ref);
    }
    const labels = await labelRefs(matter_id, hits.map((h) => h.cite));
    return ok(hits.map((h) => ({
      ref: h.cite, ...(under.has(h.cite) ? { source_ref: under.get(h.cite) } : {}), label: labels[h.cite] ?? h.header, kind: h.source_kind, date: h.event_date,
      snippet: bestSnippet(h.body, query, 400), score: Number(h.score.toFixed(4)),
    })));
  }));

  server.registerTool("get_fact", {
    title: "Get a fact",
    description:
      "One extracted fact by id (the uuid in a 'fact:<id>' ref): its summary, kind, date, amount, the verbatim quote, verification status, " +
      "and the source it came from. Use when a search hit or digest item is a fact ref and you need its provenance.",
    inputSchema: { fact_id: z.string().describe("Fact uuid, with or without the 'fact:' prefix") },
    annotations: RO,
  }, ({ fact_id }) => guard(async () => {
    const id = fact_id.replace(/^fact:/, "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("fact_id must be a uuid");
    const { data, error } = await db().from("facts")
      .select("id,matter_id,source_ref,kind,event_key,summary,event_date,amount_usd,quote,quote_verified,importance,audience,jev_support,jev_confidence,status,reject_reason,superseded_at")
      .eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return fail(`No fact ${id}`);
    const labels = await labelRefs(Number(data.matter_id), [data.source_ref]);
    return ok({ ...data, matter_id: Number(data.matter_id), source_label: labels[data.source_ref] ?? data.source_ref });
  }));

  server.registerTool("get_source", {
    title: "Open a source",
    description:
      "The full text of one source by ref: a note, email (with from / to), call log, task, Clio field, or one page of a scanned document " +
      "('doc:45#p17', page 1 if no page given). A 'fact:<id>' ref opens the source the fact came from, with the fact attached. Use to read the original behind any citation before quoting it to the user.",
    inputSchema: {
      matter_id: matterId,
      ref: z.string().min(3).describe("Source ref, e.g. 'email:88', 'note:123', 'field:Policy Limits', 'doc:45#p17'"),
    },
    annotations: RO,
  }, ({ matter_id, ref }) => guard(async () => {
    const src = await readSource(matter_id, ref);
    return src ? ok(src) : fail(`No source ${ref} on case ${matter_id}`);
  }));

  server.registerTool("ask_case", {
    title: "Ask the case",
    description:
      "Answer a free-form question about one case from its verified facts and the top retrieved passages, with every sentence cited. " +
      "Costs about one cent per call (one gpt-5.5 call), so prefer get_digest, search_case or get_source when they answer the question. " +
      "Use for synthesis questions like 'what's the treatment timeline for the shoulder' or 'why is coverage disputed'.",
    inputSchema: { matter_id: matterId, question: z.string().min(3).max(500) },
    annotations: { ...RO, idempotentHint: false },
  }, ({ matter_id, question }) => guard(async () => {
    if (!(await matterExists(matter_id))) return fail(`No case with id ${matter_id}. Call list_cases.`);
    const r = await ask(matter_id, question);
    return ok({ answer: r.answer_markdown, sources: r.cites.map((c) => ({ ref: c.source_ref, label: c.label ?? c.source_ref, quote: c.quote?.slice(0, 280) })) });
  }));

  server.registerResource("case-digest", new ResourceTemplate("gist://case/{id}/digest", {
    list: async () => {
      const { data } = await db().from("matters").select("id,display_number,client_name");
      return {
        resources: (data ?? []).map((m) => ({
          uri: `gist://case/${m.id}/digest`, name: `${m.display_number ?? m.id} digest`,
          description: m.client_name ? `Case digest for ${m.client_name}` : undefined, mimeType: "application/json",
        })),
      };
    },
  }), { title: "Case digest", description: "Compact JSON digest for one case (same as get_digest)", mimeType: "application/json" },
  async (uri, { id }) => {
    const d = await loadDigest(Number(id));
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(d ? compactDigest(d) : { error: "not found" }) }] };
  });
}

export const MCP_INSTRUCTIONS =
  "gist is a read-only knowledge base of personal-injury case files (from Clio). Start with list_cases to get a matter_id, " +
  "then get_digest for the briefing. Every claim carries a source ref; open it with get_source before quoting. " +
  "search_case finds passages cheaply; ask_case synthesizes an answer and costs about a cent. Nothing here can change the case.";

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "gist", version: "0.1.0" }, { instructions: MCP_INSTRUCTIONS });
  registerTools(server);
  return server;
}
