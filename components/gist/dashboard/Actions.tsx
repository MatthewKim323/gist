"use client";

import type { ActionItem, Digest } from "@/lib/types";
import { CiteChip, CitedValue } from "./cite";
import { OwnerChip, Panel } from "./bits";
import { daysBetween, fmtDateAgo, fmtShort } from "./format";

const BUCKETS: { key: ActionItem["bucket"]; title: string }[] = [
  { key: "overdue", title: "Overdue" },
  { key: "upcoming", title: "Coming up" },
  { key: "waiting", title: "Waiting on others" },
];

function dayText(a: ActionItem): string {
  if (a.days == null) return a.due_date ? fmtShort(a.due_date) : "";
  if (a.bucket === "overdue") return `${a.days}d late`;
  if (a.bucket === "upcoming") return a.days === 0 ? "today" : `in ${a.days}d`;
  return `${a.days}d`;
}

export default function Actions({ d }: { d: Digest }) {
  const lc = d.last_client_contact;
  const lcDays = lc ? daysBetween(lc.value) : null;
  const stale = lcDays != null && lcDays > 30;
  return (
    <Panel
      id="actions"
      title="Action"
      kicker="From Clio tasks, calendar and the gate checklist"
      aside={
        <span className={`gd-contact ${stale ? "gd-contact--stale" : ""}`}>
          <span className="gd-contact__k">Last real client contact</span>
          {lc ? (
            <CitedValue cites={lc.cites}>
              {fmtDateAgo(lc.value)}
            </CitedValue>
          ) : (
            <span>none on file</span>
          )}
        </span>
      }
    >
      <div className="gd-actions">
        {BUCKETS.map((b) => {
          const items = d.actions.filter((a) => a.bucket === b.key);
          return (
            <div key={b.key} className={`gd-bucket gd-bucket--${b.key}`}>
              <div className="gd-bucket__head">
                <span>{b.title}</span>
                <span className="gd-num gd-bucket__n">{items.length}</span>
              </div>
              {items.length ? (
                <ul>
                  {items.map((a) => (
                    <li key={a.id} className="gd-action">
                      <div className="gd-action__label">
                        {a.label}
                        <CiteChip cite={a.cite} />
                      </div>
                      <div className="gd-action__meta">
                        <OwnerChip owner={a.owner} name={a.owner_name} />
                        <span className="gd-num gd-action__days">{dayText(a)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="gd-dim gd-small gd-bucket__empty">Nothing here</div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
