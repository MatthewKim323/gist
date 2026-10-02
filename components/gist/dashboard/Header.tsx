"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { Digest } from "@/lib/types";
import { CitedValue, useCites } from "./cite";
import { fmtDate, fmtUsd, initials } from "./format";
import { extras } from "./ext";

export default function Header({ d, fixture }: { d: Digest; fixture: boolean }) {
  const m = d.matter;
  const [photoOk, setPhotoOk] = useState(true);
  const sol = extras(d).matter?.sol;
  const { share } = useCites();
  const providerAsks = d.phase.gates.filter((g) => g.owed_by === "provider" && g.status !== "have").length;
  const photo = fixture ? null : m.photo_url;
  return (
    <motion.header
      className="gd-header"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="gd-header__id">
        <div className="gd-avatar">
          {photo && photoOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={m.client_name} onError={() => setPhotoOk(false)} />
          ) : (
            <span>{initials(m.client_name)}</span>
          )}
        </div>
        <div className="gd-header__name">
          <div className="gd-eyebrow">
            <span>{m.display_number}</span>
            {m.responsible_attorney ? (
              <>
                <span className="gd-sep" />
                <span>{m.responsible_attorney}</span>
              </>
            ) : null}
          </div>
          <h1 className="gd-client">{m.client_name}</h1>
          <div className="gd-header__facts">
            {m.incident_date ? (
              <span className="gd-fact">
                <span className="gd-fact__k">Incident</span>
                <CitedValue cites={m.incident_date.cites}>{fmtDate(m.incident_date.value)}</CitedValue>
              </span>
            ) : null}
            {m.days_since_incident != null ? (
              <span className="gd-fact">
                <span className="gd-fact__k">Since</span>
                <span className="gd-num">{m.days_since_incident.toLocaleString()} days</span>
              </span>
            ) : null}
            {sol?.date ? (
              <span className="gd-fact">
                <span className="gd-fact__k">SOL</span>
                <CitedValue cites={sol.date.cites}>{fmtDate(sol.date.value)}</CitedValue>
                {sol.satisfied ? (
                  <span className="gd-solchip gd-solchip--ok">satisfied</span>
                ) : sol.days_remaining != null ? (
                  <span className={`gd-solchip ${sol.days_remaining < 90 ? "gd-solchip--bad" : ""}`}>
                    {sol.days_remaining < 0 ? `${-sol.days_remaining}d past` : `${sol.days_remaining}d left`}
                  </span>
                ) : null}
              </span>
            ) : null}
            <span className="gd-fact">
              <span className="gd-fact__k">Stage</span>
              <span className="gd-stagechip">{m.stage}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="gd-header__side">
        <div className="gd-header__btns">
        <button type="button" className="gd-sharebtn" onClick={() => share()}>
          <svg viewBox="0 0 16 16" width="13" height="13"><path d="M6.5 9.5l3-3M5.3 7.8L3.6 9.5a2.3 2.3 0 0 0 3.2 3.2l1.7-1.7M10.7 8.2l1.7-1.7a2.3 2.3 0 0 0-3.2-3.2L7.5 5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" /></svg>
          Share with provider
          {providerAsks ? <span className="gd-sharebtn__n">{providerAsks} asks</span> : null}
        </button>
        <a className="gd-btn" href={m.clio_url} target="_blank" rel="noreferrer" data-router-disabled>
          Open in Clio
          <svg viewBox="0 0 12 12" width="10" height="10"><path d="M3.5 2.5h6v6M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
        </a>
        </div>
        <div className="gd-cost" title={d.cost.models.join(" · ")}>
          <span className="gd-num">{fmtUsd(d.cost.cold_usd, { cents: true })}</span> to digest
          <span className="gd-sep" />
          <span className="gd-num">{fmtUsd(d.cost.last_run_usd, { cents: true })}</span> to reopen
        </div>
        <div className="gd-readonly">Reads Clio, writes nothing</div>
      </div>
    </motion.header>
  );
}
