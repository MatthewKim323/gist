"use client";

import Button from "@/components/gist/ui/Button";
import { useState } from "react";
import { motion } from "motion/react";
import { PHASES, type Digest, type GateItem, type GateStatus, type Owner } from "@/lib/types";
import { CiteChip, useCites } from "./cite";
import { OwnerChip, StatusIcon } from "./bits";
import { fmtDate, fmtShort } from "./format";
import GateBadge from "@/components/gist/submissions/GateBadge";
import DraftChip from "@/components/gist/actions/DraftChip";

const ORDER: Record<GateStatus, number> = { conflicting: 0, missing: 1, partial: 2, have: 3 };
const STATUS_LABEL: Record<GateStatus, string> = { have: "Have", partial: "Partial", missing: "Missing", conflicting: "Conflicting" };

function durationLabel(days: number | null): string {
  if (days == null) return "";
  if (days < 60) return `${days}d in stage`;
  const mo = Math.round(days / 30.4);
  return `${mo} mo in stage`;
}

function GateRow({ g, i }: { g: GateItem; i: number }) {
  const { share, matterId, fixture } = useCites();
  const overdue = g.due_date && new Date(g.due_date) < new Date() && g.status !== "have";
  return (
    <motion.li
      className={`gd-gate gd-gate--${g.status}`}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
     
      transition={{ delay: 0.25 + Math.min(i, 10) * 0.04, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="gd-gate__icon" title={STATUS_LABEL[g.status]}>
        <StatusIcon status={g.status} />
      </span>
      <div className="gd-gate__main">
        <div className="gd-gate__label">
          {g.label}
          <span className={`gd-gate__status gd-gate__status--${g.status}`}>{STATUS_LABEL[g.status]}</span>
        </div>
        {g.note ? <div className="gd-gate__note">{g.note}</div> : null}
        {g.status !== "have" ? <DraftChip matterId={matterId} requirementKey={g.requirement_key} fixture={fixture} /> : null}
        {g.owed_by === "provider" ? <GateBadge matterId={matterId} requirementKey={g.requirement_key} fixture={fixture} /> : null}
        {g.owed_by === "provider" && g.status !== "have" && g.owed_by_name ? (
          <div className="gd-gate__hint">
            <span>On {g.owed_by_name}&rsquo;s share link</span>
            <Button size="xs" arrow onClick={() => share(g.owed_by_contact_id)} title={`Open ${g.owed_by_name}'s share link with this ask on it`}>
              Share
            </Button>
          </div>
        ) : null}
      </div>
      <div className="gd-gate__owner">{g.status !== "have" ? <OwnerChip owner={g.owed_by} name={g.owed_by_name} /> : null}</div>
      <div className="gd-gate__days">
        {g.status !== "have" && g.days_outstanding != null ? (
          <span className={`gd-num ${g.days_outstanding > 30 ? "gd-warn" : ""}`}>{g.days_outstanding}d</span>
        ) : g.due_date && g.status !== "have" ? (
          <span className={`gd-num ${overdue ? "gd-warn" : "gd-dim"}`} title={fmtDate(g.due_date)}>due {fmtShort(g.due_date)}</span>
        ) : (
          <span className="gd-dim">&nbsp;</span>
        )}
      </div>
      <div className="gd-gate__cites">
        {g.evidence.length ? (
          <span className="gd-cites">
            {g.evidence.map((c, j) => {
              const pg = c.source_ref.match(/#p(\d+)$/);
              return (
                <span key={`${c.source_ref}-${j}`} className={pg ? "gd-pagecite" : undefined}>
                  <CiteChip cite={c} />
                  {pg ? <span className="gd-pagecite__p">p.{pg[1]}</span> : null}
                </span>
              );
            })}
          </span>
        ) : (
          <span className="gd-dim gd-small">no source</span>
        )}
      </div>
    </motion.li>
  );
}

export default function PhaseSpine({ d }: { d: Digest }) {
  const cur = PHASES.indexOf(d.phase.current as (typeof PHASES)[number]);
  const gates = [...d.phase.gates].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.days_outstanding ?? 0) - (a.days_outstanding ?? 0));
  const have = gates.filter((g) => g.status === "have").length;
  const [showAll, setShowAll] = useState(false);
  const open = gates.filter((g) => g.status !== "have");
  const LIMIT = 8;
  const visible = showAll ? gates : open.slice(0, LIMIT);
  const hidden = gates.length - visible.length;
  const owing = new Map<Owner, number>();
  for (const g of gates) if (g.status !== "have" && g.owed_by) owing.set(g.owed_by, (owing.get(g.owed_by) ?? 0) + 1);
  const pct = gates.length ? have / gates.length : 0;

  return (
    <section className="gd-spine" id="phase">
      <ol className="gd-stages" aria-label="Case phases">
        {PHASES.map((p, i) => {
          const state = cur < 0 ? "future" : i < cur ? "past" : i === cur ? "current" : "future";
          return (
            <li key={p} className={`gd-stage gd-stage--${state}`}>
              <div className="gd-stage__bar">
                {state === "current" ? (
                  <motion.div
                    className="gd-stage__fill"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 1.1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  />
                ) : null}
              </div>
              <div className="gd-stage__name">{p}</div>
              {state === "current" ? (
                <div className="gd-stage__time">
                  {durationLabel(d.phase.time_in_stage_days)}
                  {d.matter.stage_since ? (
                    <span className="gd-dim">
                      {durationLabel(d.phase.time_in_stage_days) ? " · " : ""}since {fmtShort(d.matter.stage_since)}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="gd-gates">
        <header className="gd-gates__head">
          <div>
            <div className="gd-kicker">Gate to {d.phase.next ?? "close"}</div>
            <h2 className="gd-gates__title">
              <span className="gd-num">{have}</span>
              <span className="gd-dim"> of </span>
              <span className="gd-num">{gates.length}</span>
              <span className="gd-gates__title-sub"> requirements in hand</span>
            </h2>
            <div className="gd-meter">
              <motion.div className="gd-meter__fill" initial={{ scaleX: 0 }} animate={{ scaleX: pct }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
            </div>
          </div>
          {owing.size ? (
            <div className="gd-owing">
              <div className="gd-kicker">Waiting on</div>
              <div className="gd-owing__row">
                {[...owing.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => (
                  <span key={o} className="gd-owing__item">
                    <OwnerChip owner={o} />
                    <span className="gd-num">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </header>
        <div className="gd-gate gd-gate--head" aria-hidden>
          <span />
          <span>Requirement</span>
          <span>Owed by</span>
          <span>Out</span>
          <span>Evidence</span>
        </div>
        <ul className="gd-gatelist">
          {visible.map((g, i) => (
            <GateRow key={g.requirement_key} g={g} i={i} />
          ))}
        </ul>
        {hidden > 0 || showAll ? (
          <div className="gd-more">
          <Button size="sm" variant="border" onClick={() => setShowAll((v) => !v)}>
            {showAll
              ? "Show only the most urgent"
              : `Show all ${gates.length} requirements (${open.length - visible.length} more open, ${have} in hand)`}
          </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
