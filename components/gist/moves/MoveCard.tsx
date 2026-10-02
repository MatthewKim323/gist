"use client";

// One executable "next move". The primary button really does the thing: opens the agent draft inline
// (approve & copy, open in email), opens the share sheet, accepts a provider upload, or jumps to a tab.
import "@/app/styles/gist-moves.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/gist/ui/Button";
import { ShareSheet } from "@/components/gist/share";
import { patch as patchDraft, propose, refresh as refreshDrafts, useActions } from "@/components/gist/actions/store";
import type { Move, MoveAction } from "@/lib/server/moves/types";
import type { AgentAction } from "@/lib/server/actions/types";
import { refreshMoves, setMove } from "./store";

const PARTY: Record<string, string> = { provider: "var(--o-provider)", client: "var(--o-client)", defense: "var(--o-defense)", carrier: "var(--o-carrier)", firm: "var(--o-firm)", court: "var(--o-court)" };

const KIND: Record<string, string> = { doc: "Doc", email: "Email", note: "Note", call: "Call", task: "Task", fact: "Fact", comm: "Message", bill: "Bill" };
function chipLabel(ref: string): string {
  const [k, rest = ""] = ref.split(":");
  const page = /#p(\d+)/.exec(rest)?.[1];
  return `${KIND[k] ?? k}${page ? ` p${page}` : ""}`;
}

function openTab(tab: string) {
  window.dispatchEvent(new CustomEvent("gist:open-tab", { detail: { tab } }));
}

function DraftPane({ matterId, move, onDone }: { matterId: number; move: Move; onDone: (note: string) => void }) {
  const { rows, busy, error } = useActions(matterId);
  const asked = useRef(false);
  const keys = move.primary.payload.requirementKeys ?? [];
  const a: AgentAction | undefined = (rows ?? []).find((x) => x.id === move.primary.payload.actionId)
    ?? (rows ?? []).find((x) => x.status !== "dismissed" && (keys.includes(x.requirement_key) || (x.covers ?? []).some((k) => keys.includes(k))));
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

  // no draft yet: ask the agent once, then this pane picks it up from the shared store
  useEffect(() => {
    if (rows && !a && !busy && !asked.current) {
      asked.current = true;
      void propose(matterId).then(() => refreshMoves(matterId));
    }
  }, [rows, a, busy, matterId]);

  if (!rows || (!a && busy)) return <div className="gmv-draft gmv-draft--wait">Drafting it from the case file...</div>;
  if (!a) return <div className="gmv-draft gmv-draft--wait">{error ? `Could not draft: ${error}` : "No draft for this yet."}</div>;
  const s = subject ?? a.subject;
  const b = body ?? a.body;
  const edited = subject != null || body != null;
  const save = () => (edited ? patchDraft(matterId, a.id, { subject: s, body: b }) : Promise.resolve());
  const approve = async () => {
    await save();
    try { await navigator.clipboard.writeText(`Subject: ${s}\n\n${b}`); } catch { /* clipboard blocked: still approve */ }
    await patchDraft(matterId, a.id, { status: "approved" });
    onDone(`Draft to ${a.recipient_name ?? "them"} approved and copied`);
  };
  const mailto = `mailto:${a.recipient_email ?? ""}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`;
  return (
    <div className="gmv-draft">
      <div className="gmv-draft__to">
        {a.channel} to <b>{a.recipient_name ?? "unknown"}</b>{a.recipient_email ? ` <${a.recipient_email}>` : ""}
      </div>
      <input className="gmv-draft__subject" value={s} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
      <textarea className="gmv-draft__body" value={b} onChange={(e) => setBody(e.target.value)} rows={8} aria-label="Body" />
      <div className="gmv-draft__row">
        <Button size="sm" onClick={() => void approve()}>Approve &amp; copy</Button>
        <Button size="sm" variant="border" href={mailto} external onClick={() => {
          void save().then(() => patchDraft(matterId, a.id, { status: "sent_manually" }));
          onDone(`Opened in email to ${a.recipient_name ?? "them"}, marked sent`);
        }}>Open in email</Button>
        <Button size="sm" variant="border" onClick={() => { void patchDraft(matterId, a.id, { status: "dismissed" }); void setMove(matterId, move.id, "dismissed", "Draft dismissed"); }}>Dismiss</Button>
      </div>
    </div>
  );
}

export default function MoveCard({ matterId, move, n, onDone, compact }: {
  matterId: number;
  move: Move;
  n?: number;
  onDone?: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<"draft" | "share" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const done = move.status === "done" || move.status === "dismissed";

  const finish = async (note: string) => {
    setOpen(null);
    setMsg(note);
    onDone?.(move.id);
    await setMove(matterId, move.id, "done", note);
    void refreshDrafts(matterId);
    setTimeout(() => void refreshMoves(matterId), 1400);
  };

  const run = async (act: MoveAction) => {
    const p = act.payload;
    if (act.kind === "open_draft") {
      setOpen(open === "draft" ? null : "draft");
      if (move.status === "todo") void setMove(matterId, move.id, "in_progress");
    } else if (act.kind === "open_share") {
      setOpen("share");
    } else if (act.kind === "review_upload" && p.submissionId) {
      setBusy(true);
      const r = await fetch("/api/submissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: p.submissionId, status: "accepted" }),
      }).catch(() => null);
      setBusy(false);
      if (r?.ok) await finish(`Accepted ${move.party ?? "the provider"}'s upload into the file`);
      else setMsg("Could not accept the upload. Open the inbox to review it.");
    } else if (act.kind === "open_tab" && p.tab) {
      openTab(p.tab);
      if (move.status === "todo") void setMove(matterId, move.id, "in_progress");
    } else if (act.kind === "mark_done") {
      await finish("Marked done");
    }
  };

  const closeShare = async () => {
    setOpen(null);
    await refreshMoves(matterId);
    // the server auto-advances a share move once a live link exists for that provider
    const r = await fetch(`/api/moves?matterId=${matterId}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null) as { moves?: Move[] } | null;
    const now = r?.moves?.find((m) => m.id === move.id);
    if (now?.status === "done") { setMsg(`Share link sent to ${move.party ?? "the provider"}`); onDone?.(move.id); }
  };

  const shareId = move.primary.kind === "open_share" ? move.primary.payload.providerId
    : move.secondary.find((s) => s.kind === "open_share")?.payload.providerId;

  return (
    <article className={`gmv-card${done || msg ? " is-done" : ""}${move.status === "in_progress" ? " is-active" : ""}${compact ? " is-compact" : ""}`} id={`move-${move.id}`}>
      <div className="gmv-card__n" aria-hidden>{done || msg ? "✓" : n ?? move.priority}</div>
      <div className="gmv-card__main">
        <h4 className="gmv-card__title">{move.title}</h4>
        {done || msg ? (
          <p className="gmv-card__note">{msg ?? move.note ?? (move.status === "dismissed" ? "Dismissed" : "Done")}</p>
        ) : (
          <p className="gmv-card__why">{move.why}</p>
        )}
        <div className="gmv-card__chips">
          {move.unblocks ? <span className="gmv-chip gmv-chip--unblocks">{move.unblocks}</span> : null}
          {move.party ? <span className="gmv-chip gmv-chip--party" style={{ ["--c" as string]: PARTY[move.owner ?? "firm"] }}>{move.party}</span> : null}
          {move.cites.map((c, i) => (
            <button key={`${c.source_ref}-${i}`} type="button" className="gmv-chip gmv-chip--cite" title={c.quote ?? c.label ?? c.source_ref}
              onClick={() => window.dispatchEvent(new CustomEvent("gist:open-cite", { detail: { ref: c.source_ref, quote: c.quote, label: c.label } }))}>
              {chipLabel(c.source_ref)}
            </button>
          ))}
        </div>
        {!done && !msg ? (
          <div className="gmv-card__actions">
            <Button size="sm" arrow disabled={busy} onClick={() => void run(move.primary)}>
              {open === "draft" ? "Hide draft" : move.primary.label}
            </Button>
            {!compact && move.secondary.map((s) => (
              <Button key={s.label} size="xs" variant="border" onClick={() => void run(s)}>{s.label}</Button>
            ))}
          </div>
        ) : move.status === "done" && !move.auto ? (
          <button type="button" className="gmv-undo" onClick={() => { setMsg(null); void setMove(matterId, move.id, "todo"); }}>Undo</button>
        ) : null}
        {open === "draft" && !done ? <DraftPane matterId={matterId} move={move} onDone={(note) => void finish(note)} /> : null}
      </div>
      {shareId != null && open === "share" ? createPortal(<ShareSheet matterId={matterId} initialProviderId={shareId} open onClose={() => void closeShare()} />, document.body) : null}
    </article>
  );
}
