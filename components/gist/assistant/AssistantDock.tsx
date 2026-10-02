"use client";
// Ask gist: the companion dock. A small captain in the bottom-right corner; click it for a chat panel that
// knows the whole case file, which tab you are on, and what it remembers about you. The dashboard stays
// the product: this is a sidekick, never a takeover.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot } from "@/components/gist/pilot/Bot";
import { Button } from "@/components/gist/ui/Button";
import { useCites } from "@/components/gist/dashboard/cite";
import { block } from "@/lib/captain/cycles";
import type { Citation } from "@/lib/types";
import "@/app/styles/gist-assistant.css";

const TAB_LABEL: Record<string, string> = {
  overview: "Overview", phase: "Phase & gates", money: "Money", flags: "Red flags", actions: "Next actions",
  drafts: "Agent drafts", treatment: "Treatment", injuries: "Injuries", providers: "Providers",
  inbox: "From providers", shares: "Shares", receipt: "Receipt",
};

const SUGGESTED = [
  "What do I need to tackle next?",
  "What are we waiting on and from who?",
  "Summarize the red flags for a deposition prep",
  "What changed since I last looked?",
];
const TAB_PROMPT: Record<string, string> = {
  flags: "Which of these red flags hurts us most?",
  phase: "What's blocking the next phase here?",
  money: "Is this case underwater on coverage?",
  treatment: "Any treatment gaps defense will use?",
  drafts: "Which draft should I send first?",
};

interface Msg {
  role: "user" | "assistant";
  text: string;
  cites: Citation[];
  tools: string[];
  memory: string[];
  recalled: string[];
  pending?: boolean;
  error?: boolean;
  tab?: string | null;
}

type Face = "idle" | "thinking" | "notify" | "exclaim";
const FACE_EXPR: Record<Face, string> = { idle: "curieux", thinking: "attentif", notify: "heureux", exclaim: "surpris" };

function useActiveTab(prop?: string | null): string | null {
  const [tab, setTab] = useState<string | null>(prop ?? null);
  useEffect(() => {
    if (prop) { setTab(prop); return; }
    const read = () => {
      const h = window.location.hash.slice(1);
      setTab(TAB_LABEL[h] ? h : (document.querySelector(".gd-app") ? "overview" : null));
    };
    read();
    const onTab = (e: Event) => {
      const t = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      if (t && TAB_LABEL[t]) setTab(t);
    };
    // the dashboard switches tabs with history.replaceState (no hashchange), so also poll lightly
    const iv = window.setInterval(read, 800);
    window.addEventListener("hashchange", read);
    window.addEventListener("gist:open-tab", onTab);
    return () => { window.clearInterval(iv); window.removeEventListener("hashchange", read); window.removeEventListener("gist:open-tab", onTab); };
  }, [prop]);
  return tab;
}

// ---------------- markdown with cite chips ----------------

const REF_RE = /\[([a-z_]+:[^\]\s,;]+(?:[,;]\s*[a-z_]+:[^\]\s,;]+)*)\]/g;

function Inline({ text, num, onCite }: { text: string; num: (r: string) => number; onCite: (r: string) => void }) {
  const out: ReactNode[] = [];
  let last = 0, k = 0;
  const pushText = (s: string) => {
    // **bold** and `code`
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const p of parts) {
      if (!p) continue;
      if (p.startsWith("**") && p.endsWith("**")) out.push(<strong key={k++}>{p.slice(2, -2)}</strong>);
      else if (p.startsWith("`") && p.endsWith("`")) out.push(<code key={k++}>{p.slice(1, -1)}</code>);
      else out.push(<Fragment key={k++}>{p}</Fragment>);
    }
  };
  for (const m of text.matchAll(REF_RE)) {
    pushText(text.slice(last, m.index));
    for (const r of m[1].split(/[,;]\s*/)) {
      const n = num(r);
      if (!n) continue;
      out.push(
        <button key={k++} type="button" className="ga-cite" title={r} onClick={() => onCite(r)}>{n}</button>,
      );
    }
    last = (m.index ?? 0) + m[0].length;
  }
  pushText(text.slice(last));
  return <>{out}</>;
}

function Markdown({ text, cites, onCite }: { text: string; cites: Citation[]; onCite: (c: Citation) => void }) {
  const order = useMemo(() => new Map(cites.map((c, i) => [c.source_ref, i + 1])), [cites]);
  const num = (r: string) => order.get(r) ?? 0;
  const click = (r: string) => { const c = cites.find((x) => x.source_ref === r); if (c) onCite(c); };
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.ordered ? "ol" : "ul";
    blocks.push(<L key={blocks.length}>{list.items.map((it, i) => <li key={i}><Inline text={it} num={num} onCite={click} /></li>)}</L>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    const o = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (b || o) {
      const ordered = !!o;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((b ?? o)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) blocks.push(<h4 key={blocks.length}><Inline text={h[1]} num={num} onCite={click} /></h4>);
    else blocks.push(<p key={blocks.length}><Inline text={line} num={num} onCite={click} /></p>);
  }
  flush();
  return <div className="ga-md">{blocks}</div>;
}

// ---------------- the dock ----------------

export interface AssistantDockProps {
  matterId: number;
  /** current dashboard tab id; when omitted the dock tracks the URL hash and "gist:open-tab" */
  tab?: string | null;
  /** case label for the header (client name or display number); fetched if omitted */
  caseName?: string | null;
}

export function AssistantDock({ matterId, tab: tabProp, caseName: caseProp }: AssistantDockProps) {
  const tab = useActiveTab(tabProp);
  const cites = useCites();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [face, setFace] = useState<Face>("idle");
  const [unread, setUnread] = useState(false);
  const [caseName, setCaseName] = useState<string | null>(caseProp ?? null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const loaded = useRef(false);

  useEffect(() => { if (caseProp) setCaseName(caseProp); }, [caseProp]);

  // first open: restore the latest thread and the case name
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    fetch(`/api/assistant?matterId=${matterId}`).then((r) => r.json()).then((j) => {
      const t = j?.thread;
      if (!t?.threadId) return;
      setThreadId(t.threadId);
      setMsgs((cur) => cur.length ? cur : (t.messages as { role: "user" | "assistant"; content: string; cites: Citation[]; tab: string | null }[])
        .map((m) => ({ role: m.role, text: m.content, cites: m.cites ?? [], tools: [], memory: [], recalled: [], tab: m.tab })));
    }).catch(() => {});
    if (!caseProp) {
      fetch(`/api/matter/${matterId}/digest?peek=1`).then((r) => r.json()).then((j) => {
        const m = j?.digest?.matter;
        if (m) setCaseName(m.client_name || m.display_number);
      }).catch(() => {});
    }
  }, [open, matterId, caseProp]);

  useEffect(() => { if (open) { setUnread(false); setTimeout(() => input.current?.focus(), 120); } }, [open]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [msgs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && open) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => () => abort.current?.abort(), []);

  const openCite = useCallback((c: Citation) => {
    if (cites.matterId != null) { cites.open(c); return; }
    window.dispatchEvent(new CustomEvent("gist:open-cite", { detail: { ref: c.source_ref, quote: c.quote, label: c.label } }));
    if (!document.querySelector(".gd-app")) window.open(`/api/matter/${matterId}/source/${encodeURIComponent(c.source_ref)}`, "_blank", "noopener");
  }, [cites, matterId]);

  const patchLast = (f: (m: Msg) => Msg) => setMsgs((cur) => cur.map((m, i) => (i === cur.length - 1 ? f(m) : m)));

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setDraft("");
    setBusy(true);
    setFace("thinking");
    setMsgs((cur) => [...cur,
      { role: "user", text: q, cites: [], tools: [], memory: [], recalled: [], tab },
      { role: "assistant", text: "", cites: [], tools: [], memory: [], recalled: [], pending: true }]);
    const ac = new AbortController();
    abort.current = ac;
    let landed = false;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ matterId, message: q, tab, threadId }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let e: { type: string; [k: string]: unknown };
          try { e = JSON.parse(line); } catch { continue; }
          if (e.type === "thread") setThreadId(String(e.threadId));
          else if (e.type === "recalled") patchLast((m) => ({ ...m, recalled: e.items as string[] }));
          else if (e.type === "tool") patchLast((m) => ({ ...m, tools: [...m.tools, String(e.label)] }));
          else if (e.type === "delta") patchLast((m) => ({ ...m, text: m.text + String(e.text) }));
          else if (e.type === "done") {
            landed = true;
            patchLast((m) => ({ ...m, text: String(e.text), cites: e.cites as Citation[], pending: false }));
            setFace((e.cites as Citation[]).length ? "notify" : "exclaim");
            if (!open) setUnread(true);
          } else if (e.type === "memory") patchLast((m) => ({ ...m, memory: e.items as string[] }));
          else if (e.type === "error") throw new Error(String(e.message));
        }
      }
      if (!landed) throw new Error("the answer was cut off");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        patchLast((m) => ({ ...m, pending: false, error: true, text: m.text || `Couldn't answer that: ${(err as Error).message}` }));
        setFace("exclaim");
      }
    } finally {
      setBusy(false);
      abort.current = null;
      window.setTimeout(() => setFace("idle"), 2600);
    }
  }, [busy, matterId, tab, threadId, open]);

  const newThread = () => {
    abort.current?.abort();
    setMsgs([]);
    setThreadId(null);
    setBusy(false);
    setFace("idle");
    input.current?.focus();
  };

  const cycle = useMemo(() => [block(face)], [face]);
  const prompts = useMemo(() => {
    const extra = tab ? TAB_PROMPT[tab] : null;
    return extra ? [extra, ...SUGGESTED.slice(0, 3)] : SUGGESTED;
  }, [tab]);

  return (
    <div className="ga-root" data-open={open || undefined}>
      <AnimatePresence>
        {open ? (
          <motion.section
            key="panel"
            className="ga-panel"
            role="dialog"
            aria-label="Ask gist"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <header className="ga-head">
              <div className="ga-head__title">
                <span className="ga-head__name">Ask gist</span>
                {caseName ? <span className="ga-head__case">{caseName}</span> : null}
              </div>
              <div className="ga-head__right">
                {tab && TAB_LABEL[tab] ? <span className="ga-tabchip" title="gist reads the tab you're on">Viewing {TAB_LABEL[tab]}</span> : null}
                <Button size="xs" variant="border" onClick={newThread} title="Start a new thread">New</Button>
                <button type="button" className="ga-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
              </div>
            </header>

            <div className="ga-scroll" ref={scroll}>
              {msgs.length === 0 ? (
                <div className="ga-empty">
                  <p className="ga-empty__lead">I read the whole file. Ask me anything about this case.</p>
                  <div className="ga-prompts">
                    {prompts.map((p) => (
                      <button key={p} type="button" className="ga-prompt" onClick={() => send(p)}>{p}</button>
                    ))}
                  </div>
                </div>
              ) : (
                msgs.map((m, i) => (
                  <div key={i} className={`ga-msg ga-msg--${m.role}${m.error ? " ga-msg--error" : ""}`}>
                    {m.role === "user" ? (
                      <div className="ga-bubble">{m.text}</div>
                    ) : (
                      <>
                        {m.recalled.length ? <div className="ga-meta ga-meta--recall" title={m.recalled.join("\n")}>remembering: {m.recalled[0]}{m.recalled.length > 1 ? ` +${m.recalled.length - 1}` : ""}</div> : null}
                        {m.tools.map((t, j) => <div key={j} className="ga-meta ga-meta--tool">{t}</div>)}
                        {m.text ? <Markdown text={m.text} cites={m.pending ? [] : m.cites} onCite={openCite} /> : null}
                        {m.pending && !m.text ? <div className="ga-dots" aria-label="thinking"><i /><i /><i /></div> : null}
                        {!m.pending && m.cites.length ? (
                          <div className="ga-sources">
                            {m.cites.map((c, j) => (
                              <button key={c.source_ref} type="button" className="ga-source" onClick={() => openCite(c)} title={c.quote ?? c.label}>
                                <span className="ga-cite ga-cite--static">{j + 1}</span>{c.label ?? c.source_ref}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {m.memory.map((t, j) => <div key={j} className="ga-meta ga-meta--memory">remembered: {t}</div>)}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            <form className="ga-input" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
              <textarea
                ref={input}
                rows={1}
                value={draft}
                placeholder={tab && TAB_LABEL[tab] ? `Ask about ${TAB_LABEL[tab].toLowerCase()} or anything in the case` : "Ask anything about this case"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }}
              />
              <Button size="sm" type="submit" disabled={busy || !draft.trim()}>{busy ? "..." : "Ask"}</Button>
            </form>
          </motion.section>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        className="ga-launch"
        aria-label={open ? "Close Ask gist" : "Ask gist about this case"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-busy={busy || undefined}
      >
        <Bot
          size={64}
          shape="cercle"
          color="creme"
          hat="capitaine"
          expression={FACE_EXPR[face]}
          paper="#0d1422"
          cycle={cycle}
          state={face}
          playing
        />
        {!open ? <span className="ga-launch__label">Ask gist</span> : null}
        {unread ? <span className="ga-launch__dot" /> : null}
      </button>
    </div>
  );
}

export default AssistantDock;
