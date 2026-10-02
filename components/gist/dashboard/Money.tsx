"use client";

import { motion } from "motion/react";
import type { Digest } from "@/lib/types";
import { Cites, CitedValue } from "./cite";
import { CountUp, Panel } from "./bits";
import { fmtUsd } from "./format";
import { extras } from "./ext";

const usd0 = (n: number) => fmtUsd(Math.round(n));
const usd2 = (n: number) => fmtUsd(n, { cents: true });

const STATE: Record<Digest["money"]["coverage_state"], { label: string; cls: string }> = {
  known: { label: "Coverage known", cls: "ok" },
  conflicting: { label: "Coverage conflicting", cls: "warn" },
  not_researched: { label: "Coverage not researched", cls: "muted" },
};

export default function Money({ d }: { d: Digest }) {
  const m = d.money;
  const value = m.case_value?.value ?? null;
  const limit = m.coverage_limit?.value ?? null;
  const scale = Math.max(value ?? 0, limit ?? 0) * 1.08 || 1;
  const limPct = limit != null ? (limit / scale) * 100 : null;
  const valPct = value != null ? (value / scale) * 100 : null;
  const shortfall = value != null && limit != null ? value - limit : null;
  const st = STATE[m.coverage_state];
  const liensTotal = m.liens.reduce((s, l) => s + l.value, 0);
  const x = extras(d).money;
  const lines = x?.coverage_lines ?? [];

  return (
    <Panel id="money" title="Money" kicker="Computed in code, every figure cited" className="gd-money">
      <div className="gd-money__top">
        <div className="gd-bignum">
          <div className="gd-kicker">Case value</div>
          {m.case_value ? (
            <CitedValue cites={m.case_value.cites} className="gd-bignum__v">
              <CountUp value={m.case_value.value} format={usd0} />
            </CitedValue>
          ) : (
            <div className="gd-bignum__v gd-dim">Not set</div>
          )}
        </div>
        <div className="gd-bignum">
          <div className="gd-kicker">Coverage limit</div>
          {m.coverage_limit ? (
            <CitedValue cites={m.coverage_limit.cites} className="gd-bignum__v">
              <CountUp value={m.coverage_limit.value} format={usd0} />
            </CitedValue>
          ) : (
            <div className="gd-bignum__v gd-dim">Unknown</div>
          )}
        </div>
        {m.underwater && shortfall != null ? (
          <div className="gd-bignum gd-bignum--neg">
            <div className="gd-kicker">Shortfall</div>
            <div className="gd-bignum__v">
              <CountUp value={shortfall} format={(n) => `-${usd0(n)}`} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="gd-cov" role="img" aria-label={`Case value ${value ?? "unknown"}, coverage limit ${limit ?? "unknown"}`}>
        <div className="gd-cov__track">
          {limPct != null ? (
            <motion.div className="gd-cov__covered" style={{ width: `${limPct}%` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
          ) : null}
          {valPct != null && limPct != null && valPct > limPct ? (
            <motion.div
              className="gd-cov__short"
              style={{ left: `${limPct}%`, width: `${valPct - limPct}%` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
             
              transition={{ delay: 0.9, duration: 0.6 }}
            >
              <span className="gd-cov__uw">Underwater</span>
            </motion.div>
          ) : null}
          {valPct != null && limPct == null ? <div className="gd-cov__unknown" style={{ width: `${valPct}%` }} /> : null}
          {limPct != null ? (
            <div className="gd-cov__limit" style={{ left: `${limPct}%` }}>
              <span>Limit</span>
            </div>
          ) : null}
          {valPct != null ? (
            <div className="gd-cov__value" style={{ left: `${valPct}%` }}>
              <span>Value</span>
            </div>
          ) : null}
        </div>
      </div>

      {lines.length ? (
        <table className="gd-covlines">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Per person</th>
              <th>Per occurrence</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.label}</td>
                <td className="gd-num">{l.per_person != null ? usd0(l.per_person) : "n/a"}</td>
                <td className="gd-num">{l.per_occurrence != null ? usd0(l.per_occurrence) : "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="gd-covstate">
        <span className={`gd-chip gd-chip--${st.cls}`}>{st.label}</span>
        {m.coverage_notes.map((n, i) => (
          <span key={i} className="gd-covnote">
            {n.value}
            <Cites cites={n.cites} />
          </span>
        ))}
      </div>

      <dl className="gd-ledger">
        {m.specials ? (
          <div className="gd-ledger__row">
            <dt>Medical specials</dt>
            <dd>
              <CitedValue cites={m.specials.cites}>{usd0(m.specials.value)}</CitedValue>
            </dd>
          </div>
        ) : null}
        {x?.wage_loss ? (
          <div className="gd-ledger__row">
            <dt>Wage loss claimed</dt>
            <dd>
              <CitedValue cites={x.wage_loss.cites}>{usd0(x.wage_loss.value)}</CitedValue>
            </dd>
          </div>
        ) : null}
        <div className="gd-ledger__row">
          <dt>Firm spend to date</dt>
          <dd>
            <CitedValue cites={m.firm_spend.cites}>
              <CountUp value={m.firm_spend.value} format={usd2} />
            </CitedValue>
            <Cites cites={m.firm_spend.cites} />
          </dd>
        </div>
        <div className="gd-ledger__row">
          <dt>Liens {m.liens.length ? <span className="gd-dim">({m.liens.length})</span> : null}</dt>
          <dd>
            {m.liens.length ? (
              <>
                <span className="gd-num">{usd2(liensTotal)}</span>
                {m.liens.map((l, i) => (
                  <Cites key={i} cites={l.cites} />
                ))}
              </>
            ) : (
              <span className="gd-dim">None on file</span>
            )}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}
