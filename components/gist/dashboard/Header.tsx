"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { Digest } from "@/lib/types";
import { CitedValue } from "./cite";
import { fmtDate, fmtUsd, initials } from "./format";

export default function Header({ d, fixture }: { d: Digest; fixture: boolean }) {
  const m = d.matter;
  const [photoOk, setPhotoOk] = useState(true);
  const photo = m.photo_url ?? (fixture ? null : `/api/docs/photo/${m.id}`);
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
            <span className="gd-fact">
              <span className="gd-fact__k">Stage</span>
              <span className="gd-stagechip">{m.stage}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="gd-header__side">
        <a className="gd-btn" href={m.clio_url} target="_blank" rel="noreferrer" data-router-disabled>
          Open in Clio
          <svg viewBox="0 0 12 12" width="10" height="10"><path d="M3.5 2.5h6v6M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
        </a>
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
