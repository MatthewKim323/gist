"use client";

// "Respond" affordance for one "What the firm needs from your office" item. Posts a file and/or note to
// /api/submissions, authorized by the share token or the provider session. Stored with gist only.
import { useRef, useState } from "react";
import Button from "@/components/gist/ui/Button";
import "@/app/styles/gist-submissions.css";
import { STATUS_TEXT, timeLabel, type ProviderSubmissionLite, type RespondAuth, type SubmissionKind } from "./types";

export default function RespondBox({
  label,
  requirementKey,
  auth,
}: {
  label: string;
  requirementKey: string | null;
  auth: RespondAuth;
}) {
  const mineKey = (s: ProviderSubmissionLite) =>
    requirementKey ? s.gate_requirement_key === requirementKey : s.item_label === label;
  const [sent, setSent] = useState<ProviderSubmissionLite[]>(() => auth.submissions.filter(mineKey));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [just, setJust] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<SubmissionKind>(/bill|ledger|statement/i.test(label) ? "bill" : "record");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function send() {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!file && !note.trim()) return setErr("Attach a file or write a note.");
    if (file && file.size > 10 * 1024 * 1024) return setErr("That file is over 10 MB.");
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("note", note);
    fd.set("kind", file ? kind : "note");
    fd.set("item_label", label);
    if (requirementKey) fd.set("gate_requirement_key", requirementKey);
    if (auth.matterId) fd.set("matterId", String(auth.matterId));
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        body: fd,
        headers: auth.token ? { "x-share-token": auth.token } : undefined,
      });
      const j = (await res.json().catch(() => ({}))) as { submission?: ProviderSubmissionLite; error?: string };
      if (!res.ok || !j.submission) throw new Error(j.error ?? "Could not send. Please try again.");
      setSent((s) => [j.submission!, ...s]);
      setJust(j.submission.created_at);
      setOpen(false);
      setNote("");
      setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gsub">
      {just && <div className="gsub-ok">Sent to the firm · {timeLabel(just)}</div>}
      {sent.length > 0 && (
        <ul className="gsub-past">
          {sent.slice(0, 3).map((s) => (
            <li key={s.id} className={`is-${s.status}`}>
              You sent: {s.file_name ?? "a note"}
              {s.note && s.file_name ? <em> with a note</em> : null} · {STATUS_TEXT[s.status]}
              <span> · {timeLabel(s.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <Button size="xs" variant="border" onClick={() => (setOpen(true), setJust(null))} aria-expanded={false}>
          {sent.length ? "Send more" : "Respond"}
        </Button>
      ) : (
        <div className="gsub-form">
          <div className="gsub-kinds" role="radiogroup" aria-label="What are you sending">
            {(["record", "bill"] as const).map((k) => (
              <Button key={k} size="xs" variant={kind === k ? "fill" : "border"} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "record" ? "Record" : "Bill"}
              </Button>
            ))}
          </div>
          <label className="gsub-file">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
            <span>{fileName ?? "Choose a PDF, JPG or PNG (10 MB max)"}</span>
          </label>
          <textarea
            className="gsub-note"
            rows={2}
            maxLength={2000}
            placeholder="Note for the firm (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {err && <div className="gsub-err">{err}</div>}
          <div className="gsub-actions">
            <Button size="xs" onClick={send} disabled={busy}>
              {busy ? "Sending" : "Send to the firm"}
            </Button>
            <Button size="xs" variant="border" onClick={() => (setOpen(false), setErr(null))} disabled={busy}>
              Cancel
            </Button>
          </div>
          <p className="gsub-fine">Stored with gist for your firm to review; nothing is written to Clio.</p>
        </div>
      )}
    </div>
  );
}
