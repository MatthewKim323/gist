// The firm's case list: Clio connection status plus every matter gist knows about, with its last run,
// latest digest and synced counts. Read-only against Clio (GET who_am_i, and GET matters on ?refresh=1).
import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { get, getTokens } from "@/lib/server/clio/client";
import { discoverMatters } from "@/lib/server/sync";
import { DEMO_SYNC_MESSAGE, isDemoMode } from "@/lib/server/demo-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Gate {
  status?: string;
}

function region(base: string): string {
  const host = new URL(base).hostname;
  if (host.startsWith("eu.")) return "EU";
  if (host.startsWith("ca.")) return "Canada";
  if (host.startsWith("au.")) return "Australia";
  return "US";
}

// who_am_i costs a rate-limited Clio call, so remember it briefly per process.
let whoCache: { at: number; token: string; who: { name: string | null; email: string | null } } | null = null;

async function clioStatus() {
  const base = process.env.CLIO_BASE_URL ?? "https://app.clio.com";
  const out = {
    connected: false,
    name: null as string | null,
    email: null as string | null,
    region: region(base),
    token_expires_at: null as string | null,
    error: null as string | null,
  };
  if (isDemoMode()) {
    // Public demo: a read-only snapshot, so report "connected" without touching Clio.
    return { ...out, connected: true, name: "Public demo snapshot", demo: true };
  }
  let tok;
  try {
    tok = await getTokens();
  } catch {
    return out; // never connected
  }
  out.token_expires_at = tok.expires_at;
  try {
    if (!whoCache || whoCache.token !== tok.access_token || Date.now() - whoCache.at > 5 * 60_000) {
      const r = await get<{ data: { name?: string; email?: string } }>("users/who_am_i.json", { fields: "id,name,email" });
      const fresh = await getTokens(); // a 401 refresh inside get() may have rotated the token
      whoCache = { at: Date.now(), token: fresh.access_token, who: { name: r.data?.name ?? null, email: r.data?.email ?? null } };
      out.token_expires_at = fresh.expires_at;
    }
    out.connected = true;
    out.name = whoCache.who.name;
    out.email = whoCache.who.email;
  } catch (e) {
    out.error = (e as Error).message.slice(0, 200);
  }
  return out;
}

async function count(table: "source_items" | "documents", matterId: number): Promise<number> {
  let q = db().from(table).select("*", { count: "exact", head: true }).eq("matter_id", matterId);
  if (table === "source_items") q = q.is("deleted_at", null);
  const { count: n } = await q;
  return n ?? 0;
}

async function matterSummary(m: Record<string, unknown>) {
  const id = m.id as number;
  const [run, digest, items, docs] = await Promise.all([
    db().from("agent_runs").select("id, status, started_at, finished_at, cost_usd").eq("matter_id", id)
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("digests").select("version, created_at, red_flags:json->red_flags, gates:json->phase->gates, generated_at:json->>generated_at")
      .eq("matter_id", id).order("version", { ascending: false }).limit(1).maybeSingle(),
    count("source_items", id),
    count("documents", id),
  ]);
  const d = digest.data as { version: number; created_at: string; red_flags: unknown[] | null; gates: Gate[] | null; generated_at: string | null } | null;
  const r = run.data as { id: string; status: string; started_at: string; finished_at: string | null; cost_usd: number | string | null } | null;
  const gates = Array.isArray(d?.gates) ? d!.gates : [];
  return {
    id,
    // synthetic demo case (scripts/seed-demo.ts): Supabase-only, never in Clio
    is_demo: !!m.is_demo,
    display_number: m.display_number ?? null,
    description: m.description ?? null,
    client_name: m.client_name ?? null,
    stage: m.stage ?? null,
    practice_area: m.practice_area ?? null,
    status: m.status ?? null,
    open_date: m.open_date ?? null,
    synced_at: m.synced_at ?? null,
    last_run: r ? { id: r.id, status: r.status, started_at: r.started_at, finished_at: r.finished_at, cost: Number(r.cost_usd ?? 0) } : null,
    digest: d
      ? {
          version: d.version,
          generated_at: d.generated_at ?? d.created_at,
          red_flags: Array.isArray(d.red_flags) ? d.red_flags.length : 0,
          gates_have: gates.filter((g) => g.status === "have").length,
          gates_total: gates.length,
        }
      : null,
    counts: { items, docs },
  };
}

/** GET: { clio, matters }. ?refresh=1 first pulls the matter list from Clio (GET only) into the matters table. */
export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  let refreshError: string | null = null;
  if (refresh && isDemoMode()) refreshError = DEMO_SYNC_MESSAGE;
  else if (refresh) {
    try {
      await discoverMatters();
    } catch (e) {
      refreshError = (e as Error).message.slice(0, 200);
    }
  }
  const [clio, list] = await Promise.all([
    clioStatus(),
    db().from("matters").select("id, display_number, description, status, stage, practice_area, client_name, open_date, synced_at, is_demo").order("id"),
  ]);
  if (list.error) return NextResponse.json({ error: list.error.message }, { status: 500 });
  const matters = await Promise.all((list.data ?? []).map(matterSummary));
  // Synced and open cases first, then by most recent activity.
  // Real Clio cases before demo cases.
  matters.sort((a, b) => {
    if (a.is_demo !== b.is_demo) return a.is_demo ? 1 : -1;
    const ao = a.status === "Open" ? 0 : 1;
    const bo = b.status === "Open" ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(b.synced_at ?? "").localeCompare(String(a.synced_at ?? ""));
  });
  return NextResponse.json({ clio, matters, refreshed: refresh && !refreshError, refresh_error: refreshError });
}
