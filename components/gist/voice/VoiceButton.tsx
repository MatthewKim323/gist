"use client";

// Voice agent trigger + floating call panel (state orb, live captions, hang up).
// Firm: <VoiceButton mode="firm" matterId={id} label="Brief me" onOpenSource={open} />
// Provider: <VoiceButton mode="provider" matterId={id} /> (session) or <VoiceButton mode="provider" token={t} />
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/gist/ui/Button";
import type { Citation } from "@/lib/types";
import { VoiceSession, type Caption, type VoiceState } from "@/lib/voice/client";
import "@/app/styles/gist-voice.css";

export interface VoiceButtonProps {
  mode: "firm" | "provider";
  matterId?: number;
  token?: string;
  label?: string;
  onOpenSource?: (cite: Citation) => void;
  variant?: "fill" | "border";
  size?: "md" | "sm" | "xs";
}

const STATE_LABEL: Record<VoiceState, string> = {
  idle: "Ended",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  researching: "Checking the file",
  speaking: "Speaking",
  error: "Unavailable",
  off: "Voice not configured",
};

export default function VoiceButton({ mode, matterId, token, label, onOpenSource, variant = "border", size }: VoiceButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const session = useRef<VoiceSession | null>(null);
  const orb = useRef<HTMLDivElement | null>(null);
  const tail = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(onOpenSource);
  openRef.current = onOpenSource;

  // Probe once so an unconfigured server shows a calm disabled state instead of a failing button.
  useEffect(() => {
    let live = true;
    fetch("/api/voice/token", { method: "POST" })
      .then((r) => live && setConfigured(r.status !== 503))
      .catch(() => live && setConfigured(false));
    return () => {
      live = false;
      session.current?.stop();
    };
  }, []);

  useEffect(() => {
    tail.current?.scrollIntoView({ block: "end" });
  }, [captions]);

  // Orb glow follows agent playback level.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const buf = new Uint8Array(128);
    const tick = () => {
      const a = session.current?.analyser;
      let level = 0;
      if (a) {
        a.getByteTimeDomainData(buf);
        for (const v of buf) level = Math.max(level, Math.abs(v - 128) / 128);
      }
      orb.current?.style.setProperty("--gv-level", level.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const start = () => {
    const q = new URLSearchParams({ mode });
    if (matterId) q.set("matterId", String(matterId));
    if (token) q.set("token", token);
    setCaptions([]);
    setDetail(null);
    setOpen(true);
    const s = new VoiceSession(q.toString(), {
      onState: (st, d) => {
        setState(st);
        if (st === "error" || st === "off") setDetail(d ?? null);
        if (st === "off") setConfigured(false);
      },
      onCaption: (c) => setCaptions((xs) => [...xs.slice(-30), c]),
      onOpenSource: (cite) => {
        if (!openRef.current) return false;
        openRef.current(cite);
        return true;
      },
    });
    session.current = s;
    void s.start();
  };

  const hangUp = () => {
    session.current?.stop();
    session.current = null;
  };
  const close = () => {
    hangUp();
    setOpen(false);
  };

  const active = !["idle", "error", "off"].includes(state);
  const text = label ?? (mode === "firm" ? "Brief me" : "Call the firm's case line");

  return (
    <>
      <Button
        onClick={() => (active ? close() : start())}
        variant={variant}
        size={size}
        disabled={configured === false}
        title={configured === false ? "Voice is not configured on this server" : undefined}
        aria-pressed={active}
      >
        {configured === false ? "Voice unavailable" : active ? "End call" : text}
      </Button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className={`gv-panel gv-panel--${mode}`} role="dialog" aria-label={mode === "firm" ? "Voice brief" : "Case line"} data-state={state}>
              <div className="gv-head">
                <div ref={orb} className="gv-orb" aria-hidden />
                <div className="gv-head__txt">
                  <div className="gv-title">{mode === "firm" ? "Case brief" : "Firm case line"}</div>
                  <div className="gv-state" aria-live="polite">
                    {STATE_LABEL[state]}
                  </div>
                </div>
                <button type="button" className="gv-x" onClick={close} aria-label="Close">
                  ×
                </button>
              </div>
              <div className="gv-captions" aria-live="polite">
                {captions.length === 0 && !detail ? (
                  <p className="gv-hint">
                    {state === "connecting"
                      ? "Allow the microphone, then just talk."
                      : mode === "firm"
                        ? 'Say "brief me", or ask what you are waiting on.'
                        : 'Ask "is this case still active, do you need anything from us?"'}
                  </p>
                ) : null}
                {captions.map((c) => (
                  <p key={c.id} className={`gv-cap gv-cap--${c.role}`}>
                    {c.text}
                  </p>
                ))}
                {detail ? <p className="gv-err">{detail}</p> : null}
                <div ref={tail} />
              </div>
              <div className="gv-foot">
                <span>{mode === "provider" ? "Answers from what your firm shared. Read-only." : "Answers from the latest digest. Read-only, writes nothing to Clio."}</span>
                {active ? (
                  <button type="button" className="gv-end" onClick={hangUp}>
                    End call
                  </button>
                ) : (
                  <button type="button" className="gv-end" onClick={start} disabled={state === "off"}>
                    Call again
                  </button>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export { VoiceButton };
