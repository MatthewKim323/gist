"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Digest } from "@/lib/types";
import { CiteChip, Cites } from "./cite";
import { Panel } from "./bits";
import { ago, fmtDate, fmtShort, parseDate, plural } from "./format";

const KIND_GLYPH: Record<string, string> = { note: "N", email: "E", call: "C", task: "T", calendar: "D", document: "P", doc: "P", expense: "$" };

export function SinceRail({ d }: { d: Digest }) {
  const s = d.since_last_opened;
  return (
    <aside className="gd-since" aria-label="Since you last opened">
      <div className="gd-kicker">Since you last opened</div>
      <div className="gd-since__at">{s.at ? `${fmtShort(s.at)} · ${ago(s.at)}` : "First open"}</div>
      {s.items.length ? (
        <ul className="gd-since__list">
          {s.items.map((it, i) => (
            <li key={i} className="gd-since__item">
              <span className="gd-since__glyph">{KIND_GLYPH[it.kind] ?? "+"}</span>
              <span className="gd-since__label">{it.label}</span>
              <CiteChip cite={it.cite} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="gd-dim gd-small">Nothing new.</div>
      )}
    </aside>
  );
}

export function Injuries({ d }: { d: Digest }) {
  if (!d.injuries.length) return null;
  return (
    <Panel id="injuries" title="Injuries" kicker="With page cites into the scans">
      <ul className="gd-injuries">
        {d.injuries.map((inj, i) => (
          <li key={i} className="gd-injury">
            <span className="gd-injury__part">{inj.body_part ?? "Unspecified"}</span>
            <span className="gd-injury__label" title={inj.label}>{inj.label}</span>
            <Cites cites={inj.cites} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ProviderLanes({ d }: { d: Digest }) {
  const lanes = d.providers;
  const range = useMemo(() => {
    const ts: number[] = [];
    const inc = parseDate(d.matter.incident_date?.value);
    if (inc) ts.push(inc.getTime());
    for (const l of lanes) for (const v of l.visits) { const t = parseDate(v.date); if (t) ts.push(t.getTime()); }
    ts.push(Date.now());
    const min = Math.min(...ts);
    const max = Math.max(...ts);
    return { min, max, span: Math.max(1, max - min) };
  }, [lanes, d.matter.incident_date]);
  if (!lanes.length) return null;
  const pct = (iso: string | null) => {
    const t = parseDate(iso);
    return t ? ((t.getTime() - range.min) / range.span) * 100 : 0;
  };
  const years: number[] = [];
  for (let y = new Date(range.min).getFullYear() + 1; y <= new Date(range.max).getFullYear(); y++) years.push(y);
  const incPct = d.matter.incident_date ? pct(d.matter.incident_date.value) : null;

  return (
    <Panel id="providers" title="Treatment by provider" kicker="Gaps over 60 days shaded">
      <div className="gd-lanes">
        <div className="gd-lane gd-lane--axis">
          <div />
          <div className="gd-lane__track">
            {years.map((y) => (
              <span key={y} className="gd-lane__tick" style={{ left: `${pct(`${y}-01-01`)}%` }}>{y}</span>
            ))}
            <span className="gd-lane__tick gd-lane__tick--now" style={{ left: "100%" }}>Today</span>
          </div>
        </div>
        {lanes.map((l) => (
          <div key={l.contact_id} className="gd-lane">
            <div className="gd-lane__who">
              <div className="gd-lane__name">{l.name}</div>
              <div className="gd-lane__role">
                {l.role ?? "Provider"} · {plural(l.visits.length, "visit")}
                {l.open_asks ? <span className="gd-warn"> · {l.open_asks} open ask{l.open_asks === 1 ? "" : "s"}</span> : null}
              </div>
            </div>
            <div className="gd-lane__track">
              {years.map((y) => (
                <span key={y} className="gd-lane__grid" style={{ left: `${pct(`${y}-01-01`)}%` }} />
              ))}
              {incPct != null ? <span className="gd-lane__incident" style={{ left: `${incPct}%` }} /> : null}
              {l.first_visit && l.last_visit ? (
                <span className="gd-lane__span" style={{ left: `${pct(l.first_visit)}%`, width: `${pct(l.last_visit) - pct(l.first_visit)}%` }} />
              ) : null}
              {l.gaps.map((g, i) => (
                <span
                  key={i}
                  className="gd-lane__gap"
                  style={{ left: `${pct(g.from)}%`, width: `${pct(g.to) - pct(g.from)}%` }}
                  title={`${g.days} day gap, ${fmtDate(g.from)} to ${fmtDate(g.to)}`}
                >
                  <span className="gd-lane__gaplabel">{g.days}d</span>
                </span>
              ))}
              {l.visits.map((v, i) => (
                <span key={i} className="gd-lane__visit" style={{ left: `${pct(v.date)}%` }}>
                  <CiteChip cite={{ ...v.cite, label: `${v.cite.label ?? l.name} · ${fmtDate(v.date)}` }} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function Completeness({ d, rejected }: { d: Digest; rejected: { summary: string; reason: string }[] }) {
  const c = d.completeness;
  const [open, setOpen] = useState(false);
  const rows: [string, string][] = [
    ["Clio entries read", `${c.entries_read.toLocaleString()} / ${c.entries_total.toLocaleString()}`],
    ["Document pages read", `${c.pages_read.toLocaleString()} / ${c.pages_total.toLocaleString()}`],
    ["Scanned pages OCR'd", c.pages_ocr.toLocaleString()],
    ["Facts verified", c.facts_verified.toLocaleString()],
    ["Needs attorney eyes", c.facts_review.toLocaleString()],
  ];
  return (
    <Panel id="receipt" title="Completeness receipt" kicker="What we read, and what we threw out">
      <div className="gd-receipt">
        <dl>
          {rows.map(([k, v]) => (
            <div key={k} className="gd-receipt__row">
              <dt>{k}</dt>
              <dd className="gd-num">{v}</dd>
            </div>
          ))}
          <div className="gd-receipt__row gd-receipt__row--rej">
            <dt>
              <button type="button" className="gd-linkbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!rejected.length}>
                Facts rejected by the verifier {rejected.length ? (open ? "(hide)" : "(show)") : null}
              </button>
            </dt>
            <dd className="gd-num">{c.facts_rejected.toLocaleString()}</dd>
          </div>
        </dl>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.ul className="gd-rejected" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }}>
              {rejected.map((r, i) => (
                <li key={i}>
                  <span className="gd-rejected__s">{r.summary}</span>
                  <span className="gd-rejected__r">{r.reason}</span>
                </li>
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
        <div className="gd-receipt__foot">
          Generated {fmtDate(d.generated_at)} · {d.cost.models.join(" · ")}
        </div>
      </div>
    </Panel>
  );
}
