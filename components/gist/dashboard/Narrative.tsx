"use client";

import type { Digest } from "@/lib/types";
import { CiteChip, Cites } from "./cite";
import { Panel } from "./bits";
import { fmtDate, refKindLabel } from "./format";

export function Story({ d }: { d: Digest }) {
  if (!d.story.length) return null;
  return (
    <Panel id="story" title="The story" kicker="Written from verified facts only">
      <ol className="gd-story">
        {d.story.map((s, i) => (
          <li key={i}>
            <span className="gd-story__n">{String(i + 1).padStart(2, "0")}</span>
            <p>
              {s.text}
              <Cites cites={s.cites} />
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function RedFlags({ d }: { d: Digest }) {
  if (!d.red_flags.length) return null;
  return (
    <Panel id="flags" title="Red flags" kicker={`${d.red_flags.length} contradiction${d.red_flags.length === 1 ? "" : "s"} across sources`}>
      <div className="gd-flags">
        {[...d.red_flags]
          .sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity))
          .map((f) => (
            <article key={f.id} className={`gd-flag gd-flag--${f.severity}`}>
              <header className="gd-flag__head">
                <span className={`gd-sev gd-sev--${f.severity}`}>{f.severity}</span>
                <h3>{f.title}</h3>
              </header>
              <div className="gd-flag__claims" style={{ gridTemplateColumns: `repeat(${Math.min(f.claims.length, 3)}, minmax(0, 1fr))` }}>
                {f.claims.map((c, i) => (
                  <div key={i} className="gd-claim">
                    <div className="gd-claim__meta">
                      <CiteChip cite={{ source_ref: c.source_ref, quote: c.quote, label: refKindLabel(c.source_ref) + (c.date ? ` · ${fmtDate(c.date)}` : "") }} />
                      <span>{refKindLabel(c.source_ref)}</span>
                      {c.date ? <span className="gd-dim">{fmtDate(c.date)}</span> : null}
                    </div>
                    <div className="gd-claim__says">{c.says}</div>
                    <blockquote className="gd-claim__quote">&ldquo;{c.quote}&rdquo;</blockquote>
                  </div>
                ))}
              </div>
              <p className="gd-flag__why">
                <span className="gd-kicker">Why it matters</span>
                {f.why_it_matters}
              </p>
            </article>
          ))}
      </div>
    </Panel>
  );
}
