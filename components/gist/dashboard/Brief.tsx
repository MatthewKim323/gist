"use client";
// The 90-second brief: everything an attorney needs on one scroll of Overview, no tab walking. Each block is
// one or two lines read straight off the digest (every figure keeps its cite chip) and ends in "more", which
// opens the deep tab. The tabs stay as the dig-into-everything view.
import type { ReactNode } from "react";
import type { Digest, GateItem } from "@/lib/types";
import { CiteChip, Cites, CitedValue } from "./cite";
import { fmtDate, fmtUsd } from "./format";

const OWNER_LABEL: Record<string, string> = {
  provider: "providers",
  firm: "firm",
  client: "client",
  defense: "defense",
  carrier: "carrier",
  court: "court",
};

function more(tab: string) {
  window.dispatchEvent(new CustomEvent("gist:open-tab", { detail: { tab } }));
}

function Block({ k, tab, children }: { k: string; tab?: string; children: ReactNode }) {
  return (
    <div className="gb-row">
      <div className="gb-row__k">{k}</div>
      <div className="gb-row__v">{children}</div>
      {tab ? (
        <button type="button" className="gb-more" onClick={() => more(tab)}>
          more →
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

export default function Brief({ d }: { d: Digest }) {
  const gates = d.phase.gates;
  const have = gates.filter((g) => g.status === "have").length;
  const waiting = new Map<string, number>();
  for (const g of gates as GateItem[]) {
    if (g.status === "have" || !g.owed_by) continue;
    waiting.set(g.owed_by, (waiting.get(g.owed_by) ?? 0) + 1);
  }
  const waitingSorted = [...waiting.entries()].sort((a, b) => b[1] - a[1]);

  const m = d.money;
  const liens = m.liens.reduce((s, l) => s + (l.value ?? 0), 0);
  const value = m.case_value?.value ?? null;
  const limit = m.coverage_limit?.value ?? null;
  const pct = value && limit ? Math.min(100, Math.round((limit / value) * 100)) : null;

  const flags = [...d.red_flags]
    .sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity))
    .slice(0, 3);

  const acts = [
    ...d.actions.filter((a) => a.bucket === "overdue"),
    ...d.actions.filter((a) => a.bucket === "waiting"),
    ...d.actions.filter((a) => a.bucket === "upcoming"),
  ].slice(0, 3);

  const contact = d.last_client_contact;
  const contactDays = d.last_client_contact_detail?.days_ago ?? (contact ? Math.round((Date.now() - Date.parse(contact.value)) / 86_400_000) : null);
  const since = d.since_last_opened.items.slice(0, 3);

  return (
    <section className="gd-panel gb">
      <div className="gb-head">
        <h2 className="gb-title">The brief</h2>
        <span className="gb-sub">Everything on one scroll. Every figure opens its source.</span>
      </div>

      <Block k="Story">
        <ol className="gb-story">
          {d.story.slice(0, 5).map((s, i) => (
            <li key={i}>
              {s.text} <Cites cites={s.cites} />
            </li>
          ))}
        </ol>
      </Block>

      <Block k="Phase" tab="phase">
        <span className="gb-strong">{d.phase.current}</span>
        {d.phase.next ? <span className="gb-dim"> → {d.phase.next}</span> : null}
        <span className="gb-sep">·</span>
        <span className="gb-strong">
          {have} of {gates.length}
        </span>
        <span className="gb-dim"> in hand</span>
        {waitingSorted.length ? (
          <>
            <span className="gb-sep">·</span>
            <span className="gb-dim">waiting on </span>
            {waitingSorted.map(([o, n]) => (
              <button key={o} type="button" className={`gb-chip gb-chip--${o}`} onClick={() => more("phase")}>
                {OWNER_LABEL[o] ?? o} {n}
              </button>
            ))}
          </>
        ) : null}
      </Block>

      <Block k="Money" tab="money">
        {value != null ? (
          <>
            <span className="gb-dim">value </span>
            <CitedValue cites={m.case_value?.cites} className="gb-strong">
              {fmtUsd(value)}
            </CitedValue>
          </>
        ) : null}
        {limit != null ? (
          <>
            <span className="gb-sep">vs</span>
            <span className="gb-dim">coverage </span>
            <CitedValue cites={m.coverage_limit?.cites} className="gb-strong">
              {fmtUsd(limit)}
            </CitedValue>
          </>
        ) : null}
        {m.underwater ? <span className="gb-badge gb-badge--bad">Underwater</span> : null}
        <span className="gb-sep">·</span>
        <span className="gb-dim">spend </span>
        <CitedValue cites={m.firm_spend?.cites}>{fmtUsd(m.firm_spend?.value ?? 0, { cents: true })}</CitedValue>
        {liens ? (
          <>
            <span className="gb-sep">·</span>
            <span className="gb-dim">liens </span>
            <CitedValue cites={m.liens.flatMap((l) => l.cites ?? [])}>{fmtUsd(liens)}</CitedValue>
          </>
        ) : null}
        {pct != null ? (
          <div className="gb-bar" title={`Coverage is ${pct}% of value`}>
            <span className="gb-bar__fill" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </Block>

      <Block k="Red flags" tab="flags">
        {flags.length ? (
          <ul className="gb-list">
            {flags.map((f) => (
              <li key={f.id}>
                <span className={`gb-dot gb-dot--${f.severity}`} />
                {f.title}{" "}
                {f.claims[0] ? <CiteChip cite={{ source_ref: f.claims[0].source_ref, quote: f.claims[0].quote, label: f.claims[0].label }} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <span className="gb-dim">No contradictions found.</span>
        )}
      </Block>

      <Block k="Next up" tab="actions">
        <ul className="gb-list">
          {acts.map((a) => (
            <li key={a.id}>
              <span className={`gb-dot gb-dot--${a.bucket === "overdue" ? "high" : a.bucket === "waiting" ? "medium" : "low"}`} />
              {a.label}
              {a.bucket === "overdue" && a.days != null ? <span className="gb-late"> {a.days}d overdue</span> : null}
              {a.bucket === "waiting" && a.owner ? <span className="gb-dim"> · waiting on {a.owner_name ?? OWNER_LABEL[a.owner] ?? a.owner}</span> : null}{" "}
              <CiteChip cite={a.cite} />
            </li>
          ))}
          <li>
            <span className={`gb-dot gb-dot--${contactDays != null && contactDays > 30 ? "high" : "low"}`} />
            Last real client contact{" "}
            {contact ? (
              <CitedValue cites={contact.cites} className={contactDays != null && contactDays > 30 ? "gb-late" : undefined}>
                {fmtDate(contact.value)}
                {contactDays != null ? ` · ${contactDays}d ago` : ""}
              </CitedValue>
            ) : (
              <span className="gb-late">not found in the file</span>
            )}
          </li>
        </ul>
      </Block>

      <Block k="Since you last looked">
        {since.length ? (
          <ul className="gb-list">
            {since.map((s, i) => (
              <li key={i}>
                <span className="gb-dot gb-dot--low" />
                {s.label} <CiteChip cite={s.cite} />
              </li>
            ))}
          </ul>
        ) : (
          <span className="gb-dim">{d.since_last_opened.at ? `Nothing new since ${fmtDate(d.since_last_opened.at)}.` : "First open."}</span>
        )}
      </Block>
    </section>
  );
}
