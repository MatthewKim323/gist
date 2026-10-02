"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import Button from "@/components/gist/ui/Button";
import SessionChip from "@/components/gist/auth/SessionChip";
import AutopilotCard from "@/components/gist/autopilot/AutopilotCard";
import Radar from "@/components/gist/radar/Radar";

interface Clio {
  connected: boolean;
  name: string | null;
  email: string | null;
  region: string;
  token_expires_at: string | null;
  error: string | null;
}

interface Matter {
  id: number;
  display_number: string | null;
  description: string | null;
  client_name: string | null;
  stage: string | null;
  practice_area: string | null;
  status: string | null;
  open_date: string | null;
  synced_at: string | null;
  last_run: { id: string; status: string; started_at: string; finished_at: string | null; cost: number } | null;
  digest: { version: number; generated_at: string; red_flags: number; gates_have: number; gates_total: number } | null;
  counts: { items: number; docs: number };
}

interface Data {
  clio: Clio;
  matters: Matter[];
  refresh_error?: string | null;
}

type Load = { state: "loading" } | { state: "ready"; data: Data } | { state: "error"; message: string };

/** Full navigation: these pages are separate Next routes, not engine router views. */
function go(href: string) {
  return (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    window.location.assign(href);
  };
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86400);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function usd(n: number): string {
  if (n === 0) return "$0";
  return `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export default function CasesView({ session }: { session: { role: string; name: string } | null }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchCases = useCallback(async (refresh = false) => {
    const r = await fetch(`/api/cases${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as Data & { error?: string };
    if (!r.ok) throw new Error(j.error ?? `cases ${r.status}`);
    return j;
  }, []);

  useEffect(() => {
    let live = true;
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected") === "1") setNotice("Clio connected. Pull your matters with Refresh from Clio.");
    if (p.get("clio_error")) setNotice(`Clio did not connect: ${p.get("clio_error")}`);
    if (p.has("connected") || p.has("clio_error")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      url.searchParams.delete("clio_error");
      window.history.replaceState(window.history.state, "", url);
    }
    fetchCases()
      .then((data) => live && setLoad({ state: "ready", data }))
      .catch((e) => live && setLoad({ state: "error", message: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [fetchCases]);

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const data = await fetchCases(true);
      setLoad({ state: "ready", data });
      setNotice(data.refresh_error ? `Clio refresh failed: ${data.refresh_error}` : `Pulled ${data.matters.length} matter${data.matters.length === 1 ? "" : "s"} from Clio.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const syncAndDigest = async (m: Matter) => {
    setStarting(m.id);
    setNotice(null);
    try {
      const r = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matterId: m.id }),
      });
      const j = (await r.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!r.ok || !j.runId) throw new Error(j.error ?? `pipeline ${r.status}`);
      window.location.assign(`/matter?run=${encodeURIComponent(j.runId)}&id=${m.id}`);
    } catch (e) {
      setNotice(`Could not start the run: ${(e as Error).message}`);
      setStarting(null);
    }
  };

  const data = load.state === "ready" ? load.data : null;
  const clio = data?.clio;

  return (
    <div className="gc-wrap">
      <header className="gc-top">
        <a className="gc-mark" href="/" onClick={go("/")}>
          gist
        </a>
        <SessionChip initial={session ? { role: session.role as "firm", name: session.name } : null} />
      </header>

      <section className="gc-hero">
        <div className="gc-eyebrow">Firm workspace</div>
        <h1 className="gc-title">Your cases</h1>
        <p className="gc-sub">Connect Clio, pick a case, and gist reads the whole file into one digest. Nothing is ever written back.</p>
      </section>

      {notice && (
        <p className="gc-notice" role="status">
          {notice}
        </p>
      )}

      {load.state === "loading" && <div className="gc-card gc-skel" aria-busy>Checking your Clio connection</div>}
      {load.state === "error" && (
        <div className="gc-card">
          <h2 className="gc-card__title">Could not load your cases</h2>
          <p className="gc-muted">{load.message}</p>
        </div>
      )}

      {clio && !clio.connected && (
        <section className="gc-card gc-connect">
          <div className="gc-eyebrow">Step 1</div>
          <h2 className="gc-card__title gc-card__title--big">Connect Clio</h2>
          <p className="gc-muted">
            gist asks Clio for read-only access to your matters, notes, calls, emails, tasks, custom fields and documents. It
            never creates, edits or deletes anything in Clio, and every request is a GET.
          </p>
          {clio.error && <p className="gc-error">Last attempt: {clio.error}</p>}
          <div className="gc-actions">
            <Button href="/api/clio/connect" onClick={go("/api/clio/connect")} arrow>
              Connect Clio
            </Button>
          </div>
        </section>
      )}

      {clio && clio.connected && (
        <section className="gc-card gc-clio">
          <div className="gc-clio__id">
            <span className="gc-dot" aria-hidden />
            <div>
              <div className="gc-eyebrow">Clio · {clio.region}</div>
              <div className="gc-clio__name">
                Connected as <strong>{clio.name ?? "your Clio account"}</strong>
                {clio.email ? <span className="gc-muted"> · {clio.email}</span> : null}
              </div>
              <div className="gc-faint">
                Read-only access
                {clio.token_expires_at ? ` · token renews ${new Date(clio.token_expires_at).toLocaleString()}` : " · token renews automatically"}
              </div>
            </div>
          </div>
          <div className="gc-actions">
            <Button onClick={refresh} disabled={refreshing} size="sm">
              {refreshing ? "Refreshing" : "Refresh from Clio"}
            </Button>
            <Button href="/api/clio/connect" onClick={go("/api/clio/connect")} variant="border" size="sm">
              Reconnect Clio
            </Button>
          </div>
        </section>
      )}

      {clio && clio.connected && (
        <AutopilotCard onChanged={() => void fetchCases().then((d) => setLoad({ state: "ready", data: d })).catch(() => null)} />
      )}

      {data && clio?.connected && data.matters.length === 0 && (
        <section className="gc-card gc-empty">
          <h2 className="gc-card__title">No matters yet</h2>
          <p className="gc-muted">gist has not pulled your matter list. Refresh from Clio to see every case you can open.</p>
          <div className="gc-actions">
            <Button onClick={refresh} disabled={refreshing} arrow>
              {refreshing ? "Refreshing" : "Refresh from Clio"}
            </Button>
          </div>
        </section>
      )}

      {data && data.matters.length > 0 && <Radar />}

      {data && data.matters.length > 0 && (
        <section className="gc-list" aria-label="Matters">
          <div className="gc-list__head">
            <span>
              {data.matters.length} matter{data.matters.length === 1 ? "" : "s"}
            </span>
            <span className="gc-faint">Sync &amp; digest reads the latest from Clio and rebuilds the digest. Unchanged files cost close to nothing.</span>
          </div>
          {data.matters.map((m) => (
            <article key={m.id} className="gc-row">
              <div className="gc-avatar" aria-hidden>
                {initials(m.client_name)}
              </div>
              <div className="gc-row__main">
                <div className="gc-eyebrow">
                  {m.display_number ?? `Matter ${m.id}`}
                  {m.practice_area ? <> · {m.practice_area}</> : null}
                  {m.status && m.status !== "Open" ? <> · {m.status}</> : null}
                </div>
                <h3 className="gc-client">{m.client_name ?? m.description ?? "Untitled matter"}</h3>
                <div className="gc-meta">
                  {m.stage && <span className="gc-chip">{m.stage}</span>}
                  {m.digest ? (
                    <span className="gc-digest">
                      Digested v{m.digest.version}
                      <span className="gc-sep" />
                      <span className={m.digest.red_flags ? "gc-flag" : ""}>
                        {m.digest.red_flags} red flag{m.digest.red_flags === 1 ? "" : "s"}
                      </span>
                      {m.digest.gates_total ? (
                        <>
                          <span className="gc-sep" />
                          {m.digest.gates_have}/{m.digest.gates_total} gate items
                        </>
                      ) : null}
                    </span>
                  ) : (
                    <span className="gc-faint">Not digested yet</span>
                  )}
                </div>
                <div className="gc-faint gc-row__stats">
                  {m.synced_at ? `Synced ${ago(m.synced_at)}` : "Never synced"}
                  {m.synced_at ? ` · ${m.counts.items} entries · ${m.counts.docs} docs` : ""}
                  {m.last_run
                    ? ` · last run ${m.last_run.status === "running" ? "in progress" : m.last_run.status} ${ago(m.last_run.started_at)}, ${usd(m.last_run.cost)}`
                    : ""}
                </div>
              </div>
              <div className="gc-row__btns">
                {m.digest && (
                  <Button href={`/matter?view=digest&id=${m.id}`} onClick={go(`/matter?view=digest&id=${m.id}`)} size="sm" arrow>
                    Open
                  </Button>
                )}
                <Button
                  onClick={() => void syncAndDigest(m)}
                  disabled={starting !== null || !clio?.connected}
                  variant={m.digest ? "border" : "fill"}
                  size="sm"
                  title={clio?.connected ? undefined : "Connect Clio first"}
                >
                  {starting === m.id ? "Starting" : m.last_run?.status === "running" ? "Watch run" : "Sync & digest"}
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}

      <p className="gc-foot">Reads Clio, writes nothing.</p>
    </div>
  );
}
