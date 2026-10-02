"use client";

// "From providers" inbox on the firm dashboard: what provider offices sent in answer to firm-needs items.
// Accept / Dismiss only marks review state in gist. Clio is read-only; nothing here writes to it.
import Button from "@/components/gist/ui/Button";
import { Panel } from "@/components/gist/dashboard/bits";
import "@/app/styles/gist-submissions.css";
import { setStatus, useSubmissions } from "./store";
import { timeLabel } from "./types";

function size(n: number | null) {
  if (!n) return "";
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function SubmissionsInbox({ matterId, fixture }: { matterId: number; fixture: boolean }) {
  const rows = useSubmissions(fixture ? null : matterId);
  const list = fixture ? [] : rows;
  const pending = list?.filter((r) => r.status === "pending").length ?? 0;
  return (
    <Panel
      id="from-providers"
      title="From providers"
      kicker={list ? `${pending} pending review · stored with gist, not written to Clio` : "Loading"}
    >
      {list && list.length ? (
        <ul className="gsub-inbox">
          {list.slice(0, 12).map((r) => (
            <li key={r.id} className={`gsub-inbox__row is-${r.status}`}>
              <div className="gsub-inbox__main">
                <div className="gsub-inbox__who">
                  <strong>{r.provider_name ?? "Provider"}</strong>
                  <span className="gd-dim"> · {timeLabel(r.created_at)}</span>
                  <span className={`gsub-tag is-${r.status}`}>
                    {r.status === "pending" ? "pending review" : r.status === "accepted" ? "accepted, add to Clio" : "dismissed"}
                  </span>
                </div>
                {r.item_label && <div className="gsub-inbox__item">Re: {r.item_label}</div>}
                {r.note && <p className="gsub-inbox__note">&ldquo;{r.note}&rdquo;</p>}
                {r.file_name && (
                  <div className="gsub-inbox__file">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" data-router-disabled>
                        {r.file_name}
                      </a>
                    ) : (
                      r.file_name
                    )}
                    <span className="gd-dim"> {r.kind} · {size(r.size)}</span>
                  </div>
                )}
              </div>
              <div className="gsub-inbox__acts">
                {r.status === "pending" ? (
                  <>
                    <Button size="xs" onClick={() => setStatus(matterId, r.id, "accepted")}>
                      Accept
                    </Button>
                    <Button size="xs" variant="border" onClick={() => setStatus(matterId, r.id, "dismissed")}>
                      Dismiss
                    </Button>
                  </>
                ) : (
                  <Button size="xs" variant="border" onClick={() => setStatus(matterId, r.id, "pending")}>
                    Undo
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="gd-dim gsub-empty">
          Nothing yet. Provider offices can answer the items they owe from their share link or portal.
        </p>
      )}
    </Panel>
  );
}
