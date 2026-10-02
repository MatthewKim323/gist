// The provider-facing view. Pure render (no hooks) so the public page (server) and the composer's
// live preview (client) draw the exact same thing. In preview mode, hidden sections show as
// "Redacted by firm" placeholders; on the live page they simply do not exist.
import "@/app/styles/gist-share.css";
import type { GateStatus, ProviderView, ShareSection } from "@/lib/types";
import RespondBox from "@/components/gist/submissions/RespondBox";
import CaseMoves, { type CaseMove } from "@/components/gist/autopilot/CaseMoves";
import type { RespondAuth } from "@/components/gist/submissions/types";
import { PLAIN_STAGES, SECTION_LABELS, daysAgo, fmtDate, plainStage } from "@/lib/server/share/plain";

export interface ProviderViewCardProps {
  view: ProviderView;
  mode?: "live" | "preview";
  stageNotice?: { message: string; created_at: string } | null;
  /** Autopilot case moves for this provider, newest first. When present, replaces the single stage notice. */
  caseMoves?: CaseMove[] | null;
  now?: number;
  /** Live provider pages pass this to let the office answer each firm-needs item. */
  respond?: RespondAuth | null;
}

const STATUS_COPY: Record<GateStatus, { label: string; cls: string }> = {
  have: { label: "Received", cls: "is-have" },
  partial: { label: "Partially received", cls: "is-partial" },
  missing: { label: "Still needed", cls: "is-missing" },
  conflicting: { label: "Partially received", cls: "is-partial" },
};

function relDays(n: number | null) {
  if (n === null) return "";
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 45) return `${n} days ago`;
  const m = Math.round(n / 30);
  return `${m} month${m === 1 ? "" : "s"} ago`;
}

function Redacted({ section }: { section: ShareSection }) {
  return (
    <section className="gs-sec gs-redacted" aria-label={`${SECTION_LABELS[section].title} redacted`}>
      <div className="gs-redacted__bar" />
      <div className="gs-redacted__text">
        <span className="gs-redacted__tag">Redacted by firm</span>
        <span>{SECTION_LABELS[section].title}</span>
      </div>
    </section>
  );
}

const clock = () => Date.now();

export default function ProviderViewCard({ view, mode = "live", stageNotice, caseMoves, now: nowProp, respond }: ProviderViewCardProps) {
  const now = nowProp ?? clock();
  const preview = mode === "preview";
  const hidden = new Set(view.redacted_sections);
  const stage = plainStage(view.stage);
  const lastDays = daysAgo(view.case_alive?.last_activity ?? null, now);
  const firm = view.firm_name ?? "the firm";
  const slot = (s: ShareSection, node: React.ReactNode) => (hidden.has(s) ? (preview ? <Redacted key={s} section={s} /> : null) : node);
  const trackStages = PLAIN_STAGES.slice(0, 7);

  return (
    <div className={`gs-view${preview ? " gs-view--preview" : ""}`}>
      <header className="gs-head">
        <div className="gs-eyebrow">Case status for</div>
        <h1 className="gs-title">{view.provider_name}</h1>
        <div className="gs-sub">
          Patient <strong>{view.client_initials}</strong>
          <span className="gs-dot-sep" aria-hidden>
            /
          </span>
          shared by {firm}
        </div>
      </header>

      {slot(
        "status",
        view.case_alive && (
          <section className="gs-sec gs-hero">
            <div className="gs-pulse-row">
              <span className={`gs-pulse${view.case_alive.alive ? "" : " is-quiet"}`} aria-hidden>
                <span />
              </span>
              <div>
                <div className="gs-hero__state">{view.case_alive.alive ? "Case is active" : "Case is quiet"}</div>
                <div className="gs-hero__meta">
                  {lastDays !== null ? `Firm last worked on this case ${relDays(lastDays)}` : "Activity date not on file"}
                </div>
              </div>
            </div>
            {caseMoves && caseMoves.length > 0 && <CaseMoves items={caseMoves} />}
            {stageNotice && !(caseMoves && caseMoves.length) && (
              <div className="gs-notice">
                {(() => {
                  const ns = plainStage(stageNotice.message.replace(/^Case moved to\s*/i, ""));
                  return ns ? `Case moved to ${ns.label}` : stageNotice.message;
                })()}{" "}
                <span>{fmtDate(stageNotice.created_at, { month: "short", day: "numeric" })}</span>
              </div>
            )}
            {stage && (
              <div className="gs-stage">
                <div className="gs-stage__label">
                  <span className="gs-k">Stage</span>
                  <span className="gs-stage__name">{stage.label}</span>
                </div>
                <ol className="gs-track" aria-label="Case stages">
                  {trackStages.map((s, i) => (
                    <li
                      key={s.phase}
                      className={i < stage.index ? "is-done" : i === stage.index ? "is-now" : ""}
                      title={s.label}
                    />
                  ))}
                </ol>
                <p className="gs-stage__blurb">{stage.blurb}</p>
              </div>
            )}
          </section>
        ),
      )}

      {slot(
        "firm_needs",
        view.firm_needs && (
          <section className="gs-sec gs-needs">
            <h2 className="gs-h2">
              What the firm needs from your office
              {view.firm_needs.length > 0 && <span className="gs-count">{view.firm_needs.length}</span>}
            </h2>
            {view.firm_needs.length === 0 ? (
              <p className="gs-empty">Nothing outstanding right now. Thank you.</p>
            ) : (
              <ul className="gs-needs__list">
                {view.firm_needs.map((n, i) => {
                  const overdue = n.due_date ? (daysAgo(n.due_date, now) ?? 0) > 0 : false;
                  return (
                    <li key={i} className={overdue ? "is-overdue" : ""}>
                      <span className="gs-check" aria-hidden />
                      <div className="gs-needs__body">
                        <div className="gs-needs__label">{n.label}</div>
                        <div className="gs-needs__meta">
                          {n.due_date && <span>Due {fmtDate(n.due_date, { month: "short", day: "numeric" })}</span>}
                          {overdue && n.days_outstanding ? (
                            <span className="gs-pill gs-pill--warn">{n.days_outstanding} days overdue</span>
                          ) : n.days_outstanding ? (
                            <span className="gs-pill">Requested {n.days_outstanding} days ago</span>
                          ) : null}
                        </div>
                        {respond && !preview ? (
                          <RespondBox label={n.label} requirementKey={n.requirement_key ?? null} auth={respond} />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ),
      )}

      {slot(
        "coverage_tier",
        view.coverage && (
          <section className="gs-sec gs-cov">
            <span className="gs-k">Coverage</span>
            <div className="gs-cov__tier">{view.coverage.tier}</div>
            {view.coverage.detail && <div className="gs-cov__detail">{view.coverage.detail}</div>}
          </section>
        ),
      )}

      {slot(
        "records_bills",
        view.records_bills && (
          <section className="gs-sec">
            <h2 className="gs-h2">Your records and bills</h2>
            <ul className="gs-rb">
              {view.records_bills.map((r, i) => (
                <li key={i} className={STATUS_COPY[r.status].cls}>
                  <span className="gs-rb__icon" aria-hidden />
                  <span className="gs-rb__label">{r.label}</span>
                  <span className="gs-rb__status">{STATUS_COPY[r.status].label}</span>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}

      {slot(
        "attendance",
        view.attendance && (
          <section className="gs-sec gs-att">
            <h2 className="gs-h2">Patient attendance</h2>
            {view.attendance.scheduled ? (
              <>
                <div className="gs-att__big">
                  <strong>{view.attendance.attended}</strong>
                  <span>of {view.attendance.scheduled} visit{view.attendance.scheduled === 1 ? "" : "s"} kept</span>
                </div>
                <div className="gs-att__bar" aria-hidden>
                  <span style={{ width: `${Math.round((view.attendance.attended / view.attendance.scheduled) * 100)}%` }} />
                </div>
                <div className="gs-att__win">Last {view.attendance.window_days} days</div>
              </>
            ) : (
              <p className="gs-empty">No visits on file with the firm in the last {view.attendance.window_days} days.</p>
            )}
          </section>
        ),
      )}

      {slot(
        "next_visits",
        view.next_visits && (
          <section className="gs-sec">
            <h2 className="gs-h2">Upcoming visits</h2>
            {view.next_visits.length === 0 ? (
              <p className="gs-empty">No upcoming visits on the firm calendar.</p>
            ) : (
              <ul className="gs-visits">
                {view.next_visits.map((v, i) => (
                  <li key={i}>
                    <span className="gs-visits__date">
                      <b>{fmtDate(v.date, { day: "numeric" })}</b>
                      {fmtDate(v.date, { month: "short" })}
                    </span>
                    <span className="gs-visits__label">
                      {v.label}
                      <em>{fmtDate(v.date, { weekday: "long" })}</em>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ),
      )}

      {slot(
        "updates",
        view.updates && (
          <section className="gs-sec">
            <h2 className="gs-h2">Case updates</h2>
            {view.updates.length === 0 ? (
              <p className="gs-empty">No updates shared yet.</p>
            ) : (
              <ul className="gs-updates">
                {view.updates.map((u, i) => (
                  <li key={i}>
                    {u.date && <span>{fmtDate(u.date)}</span>}
                    <p>{u.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ),
      )}

      <footer className="gs-foot">
        Shared by {firm} via gist. Read-only. Assume this page may be discoverable.
      </footer>
    </div>
  );
}
