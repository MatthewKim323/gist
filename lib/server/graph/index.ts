import "server-only";
import { db } from "../db";
import { loadMatter, type ItemRow } from "../signals/load";
import { contactMap } from "../signals/people";
import { commParties, makeLabeler } from "../signals/util";

// Case knowledge graph. Deterministic over what is already in Supabase (no model calls):
// client at the center, parties around it, documents and other sources, verified-fact event clusters
// grouped under their topic, open gate items and contradictions. Every node carries refs for cite open.

export type GraphNodeType = "client" | "party" | "document" | "source" | "topic" | "cluster" | "gate" | "contradiction";

export interface GraphRef { source_ref: string; label: string; quote?: string }

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  sub?: string | null;          // role, kind, requirement status, etc
  owner?: string | null;        // party side: client|provider|defense|carrier|court
  weight: number;               // drives radius
  status?: string | null;       // gate status
  severity?: string | null;     // contradiction severity
  count?: number;               // facts / pages / claims
  refs: GraphRef[];
}

export interface GraphEdge { source: string; target: string; kind: string; label?: string | null }

export interface CaseGraphData {
  matterId: number;
  client: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { facts: number; documents: number; parties: number; clusters: number; contradictions: number; gates: number; truncated: boolean };
}

const MAX_NODES = 150;
const MAX_CLUSTERS = 36;
const MAX_DOCS = 34;
const MAX_SOURCES = 30;
const MAX_PARTIES = 22;

const baseRef = (ref: string) => ref.split("#")[0];
function docIdOf(ref: string): string | null {
  const m = ref.match(/^(?:doc|document|doc_page):([^#]+)/);
  return m ? m[1] : null;
}
function srcNodeId(ref: string): string {
  const d = docIdOf(ref);
  return d ? `doc:${d}` : `src:${baseRef(ref)}`;
}
const titleCase = (s: string) => s.replace(/[_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

export async function buildCaseGraph(matterId: number): Promise<CaseGraphData> {
  const data = await loadMatter(matterId);
  const label = makeLabeler(data.items, data.docs);
  const contacts = contactMap(data);
  const facts = data.facts;

  const [contraRes, gateRes] = await Promise.all([
    db().from("contradictions").select("id,event_key,title,why_it_matters,severity,claims,created_at").eq("matter_id", matterId).order("created_at", { ascending: false }).limit(40),
    db().from("gate_items").select("id,phase,requirement_key,label,status,owed_by,owed_by_contact_id,evidence,note").eq("matter_id", matterId).in("status", ["missing", "conflicting", "partial"]),
  ]);
  type Claim = { fact_id?: string; source_ref?: string; says?: string; quote?: string };
  type Contra = { id: string; event_key: string | null; title: string; why_it_matters: string | null; severity: string | null; claims: Claim[] | null };
  type Gate = { id: string; phase: string; requirement_key: string; label: string; status: string; owed_by: string | null; owed_by_contact_id: number | null; evidence: { source_ref?: string; quote?: string }[] | null; note: string | null };
  // Keep only the latest contradiction per title (runs re-emit them).
  const seenTitle = new Set<string>();
  const contras = ((contraRes.data ?? []) as Contra[]).filter((c) => {
    const k = c.title.toLowerCase();
    if (seenTitle.has(k)) return false;
    seenTitle.add(k);
    return true;
  }).slice(0, 14);
  const gates = ((gateRes.data ?? []) as Gate[]).filter((g) => g.status !== "partial" || gateRes.data!.length < 12).slice(0, 18);

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (source: string, target: string, kind: string, lbl?: string | null) => {
    if (source === target) return;
    const k = `${source}|${target}|${kind}`;
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k);
    edges.push({ source, target, kind, label: lbl ?? null });
  };
  const refOf = (ref: string, quote?: string | null): GraphRef => (quote ? { source_ref: ref, label: label(ref), quote: quote.slice(0, 280) } : { source_ref: ref, label: label(ref) });

  // ---------- client ----------
  const clientId = "client";
  const clientName = data.matter.client_name ?? "Client";
  nodes.set(clientId, { id: clientId, type: "client", label: clientName, sub: data.matter.display_number ?? data.matter.description ?? null, owner: "client", weight: 10, refs: [] });
  const clientContactId = data.matter.client_contact_id != null ? Number(data.matter.client_contact_id) : null;

  // ---------- event clusters (verified facts by event_key) ----------
  interface Cl { key: string; topic: string; facts: typeof facts; imp: number }
  const clusters = new Map<string, Cl>();
  for (const f of facts) {
    const key = f.event_key || `${f.kind}.general`;
    const topic = key.split(".")[0] || f.kind;
    const cl = clusters.get(key) ?? { key, topic, facts: [], imp: 0 };
    cl.facts.push(f);
    cl.imp += f.importance ?? 3;
    clusters.set(key, cl);
  }
  const topClusters = [...clusters.values()].sort((a, b) => b.imp - a.imp).slice(0, MAX_CLUSTERS);

  // ---------- source usage (which sources back the visible graph) ----------
  const srcUse = new Map<string, number>();
  const bump = (ref: string | undefined | null, n = 1) => { if (ref) srcUse.set(srcNodeId(ref), (srcUse.get(srcNodeId(ref)) ?? 0) + n); };
  for (const cl of topClusters) for (const f of cl.facts) bump(f.source_ref);
  for (const c of contras) for (const cl of c.claims ?? []) bump(cl.source_ref, 3);
  for (const g of gates) for (const e of g.evidence ?? []) bump(e.source_ref, 2);

  // ---------- documents ----------
  const docRows = [...data.docs].sort((a, b) => {
    const ua = srcUse.get(`doc:${a.clio_id}`) ?? 0, ub = srcUse.get(`doc:${b.clio_id}`) ?? 0;
    return ub - ua || (b.page_count ?? 0) - (a.page_count ?? 0);
  }).slice(0, MAX_DOCS);
  for (const d of docRows) {
    const id = `doc:${d.clio_id}`;
    nodes.set(id, {
      id, type: "document", label: d.name ?? d.filename ?? `Document ${d.clio_id}`, sub: d.folder ?? null,
      weight: 2 + Math.min(6, Math.sqrt(d.page_count ?? 1)), count: d.page_count ?? 0,
      refs: [refOf(`document:${d.clio_id}`)],
    });
  }

  // ---------- other sources (notes, emails, calls...) that back facts / claims / gates ----------
  const itemById = new Map<string, ItemRow>(data.items.map((i) => [i.id, i]));
  const srcPartyLinks: [number, string][] = [];
  const otherSrc = [...srcUse.entries()].filter(([id]) => id.startsWith("src:")).sort((a, b) => b[1] - a[1]).slice(0, MAX_SOURCES);
  for (const [id, n] of otherSrc) {
    const ref = id.slice(4);
    const it = itemById.get(ref);
    const kind = ref.split(":")[0];
    nodes.set(id, { id, type: "source", label: label(ref), sub: kind, weight: 1.5 + Math.min(3, n / 3), count: n, refs: [refOf(ref)] });
    // Who wrote / received it.
    if (it) {
      const { senders, receivers } = commParties(it);
      for (const p of [...senders, ...receivers]) if (p.id != null) srcPartyLinks.push([Number(p.id), id]);
    }
  }

  // ---------- parties ----------
  const partyIds = new Set<number>();
  const providerFacts = new Map<number, number>();
  for (const f of facts) if (f.provider_contact_id != null) providerFacts.set(Number(f.provider_contact_id), (providerFacts.get(Number(f.provider_contact_id)) ?? 0) + 1);
  const ranked = [...contacts.values()].filter((c) => c.id !== clientContactId).sort((a, b) => {
    const sa = (a.role ? 10 : 0) + (providerFacts.get(a.id) ?? 0), sb = (b.role ? 10 : 0) + (providerFacts.get(b.id) ?? 0);
    return sb - sa;
  }).filter((c) => c.role || providerFacts.has(c.id) || gates.some((g) => g.owed_by_contact_id === c.id)).slice(0, MAX_PARTIES);
  for (const c of ranked) {
    const id = `party:${c.id}`;
    partyIds.add(c.id);
    nodes.set(id, {
      id, type: "party", label: c.name, sub: c.role, owner: c.owner ?? "other",
      weight: 3 + Math.min(4, (providerFacts.get(c.id) ?? 0) / 4), count: providerFacts.get(c.id) ?? 0,
      refs: c.relationshipRef ? [refOf(c.relationshipRef)] : [],
    });
    addEdge(clientId, id, "role", c.role);
  }
  const partyNode = (cid: number | null | undefined) => (cid == null ? null : cid === clientContactId ? clientId : partyIds.has(cid) ? `party:${cid}` : null);
  for (const [cid, sid] of srcPartyLinks) { const p = partyNode(cid); if (p) addEdge(p, sid, "authored"); }

  // ---------- topics + clusters ----------
  const topics = new Map<string, number>();
  for (const cl of topClusters) topics.set(cl.topic, (topics.get(cl.topic) ?? 0) + cl.facts.length);
  for (const [t, n] of topics) {
    const id = `topic:${t}`;
    nodes.set(id, { id, type: "topic", label: titleCase(t), weight: 4 + Math.min(4, Math.sqrt(n)), count: n, refs: [] });
    addEdge(clientId, id, "topic");
  }
  for (const cl of topClusters) {
    const id = `cluster:${cl.key}`;
    const best = [...cl.facts].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    const rest = cl.key.split(".").slice(1).join(" ") || cl.key;
    nodes.set(id, {
      id, type: "cluster", label: titleCase(rest), sub: best[0]?.summary ?? null,
      weight: 1.5 + Math.min(5, cl.imp / 4), count: cl.facts.length,
      refs: best.slice(0, 8).map((f) => refOf(f.source_ref, f.quote)),
    });
    addEdge(`topic:${cl.topic}`, id, "topic");
    for (const f of cl.facts) {
      const sid = srcNodeId(f.source_ref);
      if (nodes.has(sid)) addEdge(id, sid, "supports");
      const p = partyNode(f.provider_contact_id);
      if (p) { addEdge(p, id, "about"); if (nodes.has(sid)) addEdge(p, sid, "about"); }
    }
  }

  // ---------- contradictions ----------
  for (const c of contras) {
    const id = `contra:${c.id}`;
    const claims = c.claims ?? [];
    nodes.set(id, {
      id, type: "contradiction", label: c.title, sub: c.why_it_matters, severity: c.severity ?? "medium",
      weight: c.severity === "high" ? 5 : c.severity === "low" ? 3 : 4, count: claims.length,
      refs: claims.filter((x) => x.source_ref).map((x) => refOf(x.source_ref!, x.quote ?? x.says)),
    });
    for (const cl of claims) if (cl.source_ref) { const sid = srcNodeId(cl.source_ref); if (nodes.has(sid)) addEdge(id, sid, "claim"); }
    if (c.event_key && nodes.has(`cluster:${c.event_key}`)) addEdge(id, `cluster:${c.event_key}`, "claim");
    else if (c.event_key && nodes.has(`topic:${c.event_key.split(".")[0]}`)) addEdge(id, `topic:${c.event_key.split(".")[0]}`, "claim");
    if (![...edgeKeys].some((k) => k.startsWith(`${id}|`))) addEdge(id, clientId, "claim");
  }

  // ---------- gates ----------
  for (const g of gates) {
    const id = `gate:${g.id}`;
    const ev = g.evidence ?? [];
    nodes.set(id, {
      id, type: "gate", label: g.label, sub: [g.phase, g.owed_by ? `owed by ${g.owed_by}` : null].filter(Boolean).join(" · "),
      status: g.status, owner: g.owed_by, weight: g.status === "missing" ? 3.5 : 3, count: ev.length,
      refs: ev.filter((e) => e.source_ref).map((e) => refOf(e.source_ref!, e.quote)),
    });
    const owner = partyNode(g.owed_by_contact_id) ?? (g.owed_by === "client" ? clientId : null);
    addEdge(owner ?? clientId, id, "owes");
    for (const e of ev) if (e.source_ref) { const sid = srcNodeId(e.source_ref); if (nodes.has(sid)) addEdge(id, sid, "evidence"); }
  }

  // ---------- cap ----------
  let list = [...nodes.values()];
  const truncated = list.length > MAX_NODES;
  if (truncated) {
    const prio: Record<GraphNodeType, number> = { client: 0, contradiction: 1, gate: 2, topic: 3, party: 4, cluster: 5, document: 6, source: 7 };
    list = list.sort((a, b) => prio[a.type] - prio[b.type] || b.weight - a.weight).slice(0, MAX_NODES);
  }
  const keep = new Set(list.map((n) => n.id));
  // Drop orphan sources/documents: they add noise without a connection.
  const deg = new Map<string, number>();
  const kept = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  for (const e of kept) { deg.set(e.source, (deg.get(e.source) ?? 0) + 1); deg.set(e.target, (deg.get(e.target) ?? 0) + 1); }
  for (const n of list) if ((n.type === "document" || n.type === "source") && !deg.get(n.id)) addOrphanDoc(n);
  function addOrphanDoc(n: GraphNode) { kept.push({ source: clientId, target: n.id, kind: "file", label: null }); }

  return {
    matterId, client: clientName, nodes: list, edges: kept,
    stats: {
      facts: facts.length, documents: data.docs.length, parties: partyIds.size, clusters: topClusters.length,
      contradictions: contras.length, gates: gates.length, truncated,
    },
  };
}
