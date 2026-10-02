"use client";

// "Agent drafts": gist's agent proposes the next move for every blocking item; the attorney approves,
// edits or dismisses. Nothing is sent from here and nothing is written to Clio.
import "@/app/styles/gist-actions.css";
import { useEffect, useState } from "react";
import Button from "@/components/gist/ui/Button";
import { Panel } from "@/components/gist/dashboard/bits";
import { CiteChip, useCites } from "@/components/gist/dashboard/cite";
import type { Digest } from "@/lib/types";
import type { AgentAction, ActionKind } from "@/lib/server/actions/types";
import { patch, propose, useActions } from "./store";

const KIND_LABEL: Record<ActionKind, string> = {
  records_request: "Records request",
  client_followup: "Client follow-up",
  defense_demand: "Discovery letter",
  carrier_followup: "Carrier follow-up",
  internal_task: "Internal task",
};

function DraftCard({ a, matterId }: { a: AgentAction; matterId: number }) {
  const { share } = useCites();
  const [subject, setSubject] = useState(a.subject);
  const [body, setBody] = useState(a.body);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setSubject(a.subject);
    setBody(a.body);
  }, [a.subject, a.body]);
  const dirty = subject !== a.subject || body !== a.body;
  const edits = () => (dirty ? { subject, body } : {});
  const save = () => {
    if (dirty) void patch(matterId, a.id, { subject, body });
  };

  const approve = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
    void patch(matterId, a.id, { ...edits(), status: "approved" });
  };
  const mailto = `mailto:${a.recipient_email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const openMail = () => void patch(matterId, a.id, { ...edits(), status: "sent_manually" });

  return (
    <li id={`draft-${a.id}`} className={`gact-card is-${a.status}`}>
      <div className="gact-card__head">
        <span className={`gact-kind gact-kind--${a.kind}`}>{KIND_LABEL[a.kind]}</span>
        <span className="gact-to">
          To <strong>{a.recipient_name ?? "recipient"}</strong>
          {a.recipient_email ? <span className="gact-email">{a.recipient_email}</span> : <span className="gact-email gact-dim">no email on file</span>}
        </span>
        <span className="gact-meta">
          {a.status === "approved" ? <span className="gact-pill is-approved">Approved</span> : null}
          {a.edited ? <span className="gact-pill">Edited</span> : null}
          <span className="gact-pill gact-dim">{a.source === "model" ? "Agent draft" : "Standard letter"}</span>
        </span>
      </div>
      {a.rationale ? (
        <div className="gact-why">
          <span className="gact-why__label">Why</span>
          <span>{a.rationale}</span>
          {a.cites?.length ? (
            <span className="gd-cites gact-cites">
              {a.cites.map((c, i) => (
                <CiteChip key={`${c.source_ref}-${i}`} cite={c} />
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      <label className="gact-field">
        <span>Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={save} />
      </label>
      <label className="gact-field">
        <span>Message</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} onBlur={save} rows={Math.min(18, Math.max(8, body.split("\n").length + 1))} />
      </label>
      <div className="gact-actions">
        <Button size="sm" onClick={approve}>{copied ? "Copied" : "Approve & copy"}</Button>
        <Button size="sm" variant="border" href={mailto} external onClick={openMail}>Open in email</Button>
        <Button size="sm" variant="border" onClick={() => void patch(matterId, a.id, { status: "dismissed" })}>Dismiss</Button>
        {a.kind === "records_request" && a.recipient_contact_id ? (
          <button type="button" className="gact-link" onClick={() => share(a.recipient_contact_id)}>
            Also send {a.recipient_name}&rsquo;s share link
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Self-contained: fetches its own drafts. `digest` is optional (fixture digests render nothing). Cite chips and the
 *  share-link shortcut use the dashboard CiteProvider when mounted inside it. */
export default function AgentDrafts({ matterId, digest, fixture }: { matterId: number; digest?: Digest | null; fixture?: boolean }) {
  void digest;
  const { rows, busy, error } = useActions(fixture ? null : matterId);
  const [showDone, setShowDone] = useState(false);
  if (fixture) return null;
  const open = (rows ?? []).filter((r) => r.status === "proposed" || r.status === "approved");
  const done = (rows ?? []).filter((r) => r.status === "dismissed" || r.status === "sent_manually");
  const ready = open.filter((r) => r.status === "proposed").length;
  const kicker = rows == null ? "Loading" : ready ? `${ready} draft${ready === 1 ? "" : "s"} ready` : open.length ? "All reviewed" : "No drafts yet";
  return (
    <Panel
      id="drafts"
      title="Agent drafts"
      kicker={kicker}
      className="gact"
      aside={
        <Button size="xs" variant="border" disabled={busy} onClick={() => void propose(matterId)}>
          {busy ? "Drafting" : open.length ? "Redraft follow-ups" : "Draft follow-ups"}
        </Button>
      }
    >
      <p className="gact-note">Drafted for attorney review. gist never sends or writes to Clio.</p>
      {error ? <p className="gact-error">{error}</p> : null}
      {open.length ? (
        <ul className="gact-list">
          {open.map((a) => (
            <DraftCard key={a.id} a={a} matterId={matterId} />
          ))}
        </ul>
      ) : rows && !busy ? (
        <p className="gact-empty">Nothing drafted yet. gist drafts a records request, client follow-up, discovery letter or carrier follow-up for every item someone outside the firm still owes.</p>
      ) : null}
      {done.length ? (
        <div className="gact-done">
          <button type="button" className="gact-link" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide" : "Show"} {done.length} handled
          </button>
          {showDone ? (
            <ul className="gact-donelist">
              {done.map((a) => (
                <li key={a.id}>
                  <span>{a.subject}</span>
                  <em>{a.status === "sent_manually" ? "opened in email" : "dismissed"}</em>
                  <button type="button" className="gact-link" onClick={() => void patch(matterId, a.id, { status: "proposed" })}>Restore</button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
