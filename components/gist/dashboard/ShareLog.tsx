"use client";

import { useEffect, useState } from "react";
import { useCites } from "./cite";
import { Panel } from "./bits";
import { ago, fmtShort } from "./format";

interface ShareRow {
  id: string;
  provider_contact_id: number | null;
  provider_name: string | null;
  created_at: string;
  state: "active" | "revoked" | "expired";
  view_count: number;
  last_viewed_at: string | null;
  views?: { viewed_at: string; device: string }[];
}

/** Links sent to providers and whether anyone opened them. GET /api/share?matterId= */
export default function ShareLog({ matterId, fixture }: { matterId: number; fixture: boolean }) {
  const { share } = useCites();
  const [rows, setRows] = useState<ShareRow[] | null>(null);
  useEffect(() => {
    if (fixture) return setRows([]);
    let live = true;
    const load = () =>
      fetch(`/api/share?matterId=${matterId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { shares: [] }))
        .then((j: { shares?: ShareRow[] }) => live && setRows(j.shares ?? []))
        .catch(() => live && setRows([]));
    void load();
    const t = setInterval(load, 20000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [matterId, fixture]);

  const opens = rows?.reduce((s, r) => s + r.view_count, 0) ?? 0;
  return (
    <Panel
      id="shares"
      title="Share log"
      kicker={rows ? `${rows.length} link${rows.length === 1 ? "" : "s"} sent · ${opens} open${opens === 1 ? "" : "s"}` : "Loading"}
      aside={
        <button type="button" className="gd-sharebtn gd-sharebtn--sm" onClick={() => share()}>
          New share link
        </button>
      }
    >
      {rows && rows.length ? (
        <ul className="gd-sharelog">
          {rows.slice(0, 8).map((r) => (
            <li key={r.id} className={`gd-sharelog__row gd-sharelog__row--${r.state}`}>
              <span className="gd-sharelog__who">{r.provider_name ?? "Provider"}</span>
              <span className="gd-dim">sent {fmtShort(r.created_at)}</span>
              <span className={`gd-sharelog__state gd-sharelog__state--${r.state}`}>{r.state}</span>
              <span className="gd-sharelog__opens">
                {r.view_count ? (
                  <>
                    <span className="gd-sharelog__dot" />
                    opened {r.view_count}x · {ago(r.last_viewed_at)}
                    {r.views?.[0]?.device ? <span className="gd-dim"> · {r.views[0].device}</span> : null}
                  </>
                ) : (
                  <span className="gd-dim">not opened yet</span>
                )}
              </span>
              <button type="button" className="gd-linkbtn" onClick={() => share(r.provider_contact_id)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      ) : rows ? (
        <div className="gd-dim gd-small">No links sent yet. Provider-owed gate items become that provider&rsquo;s ask list.</div>
      ) : null}
    </Panel>
  );
}
