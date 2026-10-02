"use client";

// "Needs attention": the firm-wide radar strip on /cases. Every signal is computed in code from saved digests
// (lib/server/radar) and opens the exact dashboard section it came from.

import { useEffect, useState, type MouseEvent } from "react";
import Button from "@/components/gist/ui/Button";
import "@/app/styles/gist-radar.css";

type Severity = "high" | "medium" | "low";
interface Signal {
  id: string;
  matter_id: number;
  client: string;
  display_number: string | null;
  kind: string;
  severity: Severity;
  headline: string;
  detail: string;
  days: number | null;
  cite: { source_ref: string; label: string } | null;
  href: string;
}
interface Data {
  signals: Signal[];
  counts: Record<string, number>;
  cases_scanned: number;
  cases_total: number;
  generated_at: string;
}

const KIND_LABEL: Record<string, string> = {
  policy_limits: "Policy limits",
  sol: "SOL",
  client_silent: "Client contact",
  provider_asks: "Provider asks",
  phase_stalled: "Phase",
  red_flags: "Red flags",
  treatment_gap: "Treatment gap",
  coverage: "Coverage",
};
const COLLAPSED = 5;

function go(href: string) {
  return (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    window.location.assign(href);
  };
}

export default function Radar() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/radar", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Data & { error?: string };
        if (!r.ok) throw new Error(j.error ?? `radar ${r.status}`);
        if (live) setData(j);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, []);

  if (error) return null; // the case list below still works; the radar is additive
  if (!data) return <section className="gr gr--loading" aria-busy aria-label="Needs attention" />;
  if (data.cases_scanned === 0) return null;

  const { signals } = data;
  const high = signals.filter((s) => s.severity === "high").length;
  const cases = new Set(signals.map((s) => s.matter_id));
  const shown = open ? signals : signals.slice(0, COLLAPSED);
  // Group by case once more than one case is on the board, keeping the severity order of each case's top signal.
  const groups: { id: number; client: string; number: string | null; items: Signal[] }[] = [];
  for (const s of shown) {
    let g = groups.find((x) => x.id === s.matter_id);
    if (!g) groups.push((g = { id: s.matter_id, client: s.client, number: s.display_number, items: [] }));
    g.items.push(s);
  }
  const grouped = cases.size > 1;

  return (
    <section className="gr" aria-label="Needs attention">
      <header className="gr__head">
        <div>
          <div className="gr__eyebrow">Radar · across every case</div>
          <h2 className="gr__title">Needs attention</h2>
        </div>
        <div className="gr__tally">
          {signals.length ? (
            <>
              <span className="gr__num">{signals.length}</span>
              <span>
                signal{signals.length === 1 ? "" : "s"} in {cases.size} of {data.cases_scanned} digested case{data.cases_scanned === 1 ? "" : "s"}
                {high ? <span className="gr__hi"> · {high} high</span> : null}
              </span>
            </>
          ) : null}
        </div>
      </header>

      {signals.length === 0 ? (
        <p className="gr__empty">
          <span className="gr__dot gr__dot--ok" aria-hidden />
          Nothing urgent across {data.cases_scanned} case{data.cases_scanned === 1 ? "" : "s"}.
        </p>
      ) : (
        <div className="gr__list">
          {groups.map((g) => (
            <div key={g.id} className="gr__group">
              {grouped && (
                <div className="gr__case">
                  {g.client}
                  {g.number ? <span className="gr__faint"> · {g.number}</span> : null}
                </div>
              )}
              {g.items.map((s) => (
                <article key={s.id} className={`gr__row gr__row--${s.severity}`}>
                  <span className={`gr__dot gr__dot--${s.severity}`} aria-label={`${s.severity} severity`} />
                  <div className="gr__main">
                    <div className="gr__meta">
                      <span className="gr__kind">{KIND_LABEL[s.kind] ?? s.kind}</span>
                      {!grouped && <span className="gr__faint"> · {s.client}</span>}
                    </div>
                    <h3 className="gr__headline">{s.headline}</h3>
                    <p className="gr__detail">{s.detail}</p>
                    {s.cite && (
                      <a className="gr__cite" href={s.href} onClick={go(s.href)} title={s.cite.source_ref}>
                        {s.cite.label}
                      </a>
                    )}
                  </div>
                  <div className="gr__btn">
                    <Button href={s.href} onClick={go(s.href)} size="xs" variant="border" arrow>
                      Open
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ))}
        </div>
      )}

      {signals.length > COLLAPSED && (
        <button type="button" className="gr__more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Show fewer" : `Show all ${signals.length}`}
        </button>
      )}
    </section>
  );
}
