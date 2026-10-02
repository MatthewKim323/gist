"use client";
// Pick a case to ingest. Shown on /matter after sign-in, before the pipeline timeline starts.
// "Ingest" replays the case's best recorded run when one exists (real rows, $0); a never-digested case
// starts a real pipeline run. "Run live" always starts a fresh run against Clio.
import { useEffect, useState } from "react";
import Button from "@/components/gist/ui/Button";
import "@/app/styles/gist-picker.css";

interface CaseRow {
  id: number;
  is_demo: boolean;
  display_number: string | null;
  client_name: string | null;
  description: string | null;
  stage: string | null;
  practice_area: string | null;
  last_run: { id: string; status: string } | null;
  digest: { version: number } | null;
  counts?: { items?: number; docs?: number };
}

export type Picked = { matterId: number; runId: string };

export default function CasePicker({ onPicked }: { onPicked: (p: Picked) => void }) {
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // /api/matter is Supabase-only and fast: render from it right away. /api/cases (which also checks the
    // Clio connection) fills in run details when it arrives.
    let full = false;
    fetch("/api/matter", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { matters?: (CaseRow & { digest?: { version: number } | null })[] }) => {
        if (full) return;
        const rows = (j.matters ?? []).map((m) => ({ ...m, last_run: null, digest: m.digest ?? null }));
        rows.sort((a, b) => Number(a.is_demo) - Number(b.is_demo));
        setCases(rows);
      })
      .catch(() => null);
    fetch("/api/cases", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { matters?: CaseRow[] }) => {
        full = true;
        if (j.matters?.length) setCases(j.matters);
      })
      .catch(() => setCases((c) => c ?? []));
  }, []);

  async function live(id: number): Promise<Picked> {
    const res = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterId: id }),
    });
    if (!res.ok) throw new Error(`pipeline ${res.status}`);
    const { runId } = (await res.json()) as { runId: string };
    return { matterId: id, runId };
  }

  async function ingest(c: CaseRow, mode: "best" | "live") {
    setBusy(c.id);
    setErr(null);
    try {
      if (mode === "best") {
        const r = await fetch(`/api/pipeline/replay?matterId=${c.id}`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { runId?: string };
          if (j.runId) return onPicked({ matterId: c.id, runId: j.runId });
        }
      }
      onPicked(await live(c.id));
    } catch (e) {
      setErr(`Could not start: ${(e as Error).message}`);
      setBusy(null);
    }
  }

  return (
    <div className="gk-root">
      <div className="gk-wrap">
        <p className="gk-eyebrow">Choose a case</p>
        <h1 className="gk-title">What are we digesting?</h1>
        <p className="gk-lede">gist reads the whole matter from Clio, read only, verifies every fact, and builds the brief.</p>
        {cases === null ? (
          <p className="gk-muted">Loading your cases…</p>
        ) : cases.length === 0 ? (
          <div className="gk-empty">
            <p>No cases synced yet.</p>
            <Button href="/cases" arrow>Connect Clio</Button>
          </div>
        ) : (
          <ul className="gk-list">
            {cases.map((c) => (
              <li key={c.id} className={`gk-card${busy === c.id ? " is-busy" : ""}`}>
                <div className="gk-avatar">{initials(c.client_name)}</div>
                <div className="gk-body">
                  <div className="gk-meta">
                    <span>{c.display_number ?? `Matter ${c.id}`}</span>
                    {c.practice_area ? <span>· {c.practice_area}</span> : null}
                    {c.is_demo ? <span className="gk-chip gk-chip--demo">Demo</span> : <span className="gk-chip gk-chip--live">Live from Clio</span>}
                  </div>
                  <div className="gk-name">{c.client_name ?? c.description ?? "Untitled matter"}</div>
                  <div className="gk-sub">
                    {c.stage ? <span className="gk-chip">{c.stage}</span> : null}
                    <span className="gk-muted">{c.digest ? `Digested v${c.digest.version}` : "Not digested yet"}</span>
                  </div>
                </div>
                <div className="gk-actions">
                  <Button onClick={() => void ingest(c, "best")} arrow disabled={busy !== null}>
                    {busy === c.id ? "Starting" : "Ingest case"}
                  </Button>
                  {!c.is_demo ? (
                    <button type="button" className="gk-link" disabled={busy !== null} onClick={() => void ingest(c, "live")}>
                      Run live against Clio
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {err ? <p className="gk-err">{err}</p> : null}
      </div>
    </div>
  );
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}
