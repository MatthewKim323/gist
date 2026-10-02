"use client";

// Attorney share composer: pick a provider, toggle sections, override facts, redact terms, watch the
// exact provider page update on the right (hidden sections drawn as "Redacted by firm"), see what the
// Jev gate held back, publish a tokenized link + QR, and watch it get opened live. Revoke any time.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ProviderView, ShareConfig, ShareSection } from "@/lib/types";
import { SECTION_LABELS, SECTION_ORDER, defaultShareConfig, fmtDate } from "@/lib/server/share/plain";
import ProviderViewCard from "./ProviderViewCard";
import "@/app/styles/gist-share.css";

interface ProviderOption {
  contact_id: number;
  name: string;
  role: string | null;
}
interface Finding {
  key: string;
  section: ShareSection;
  text: string;
  reason: string;
  score: number;
  engine: string;
}
interface Candidate {
  id: string;
  summary: string;
  kind: string;
  date: string | null;
  audience: string;
  included: boolean;
  overridden: boolean;
}
interface PreviewResp {
  view: ProviderView;
  findings: Finding[];
  candidates: Candidate[];
  gate: { checked: number; blocked: number; engine: string; ms: number };
}
interface ShareListItem {
  id: string;
  provider_contact_id: number | null;
  provider_name: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  state: "active" | "revoked" | "expired";
  view_count: number;
  last_viewed_at: string | null;
  views: { viewed_at: string; device: string }[];
}

export interface ShareComposerProps {
  matterId: number;
  /** Preselect a provider (Clio contact id). */
  initialProviderId?: number;
  /** Shows a close button when provided (sheet mode). */
  onClose?: () => void;
  className?: string;
}

let anon: SupabaseClient | null = null;
function anonClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!anon) anon = createClient(url, key, { auth: { persistSession: false } });
  return anon;
}

function timeOf(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function ShareComposer({ matterId, initialProviderId, onClose, className }: ShareComposerProps) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerId, setProviderId] = useState<number | null>(initialProviderId ?? null);
  const [config, setConfig] = useState<ShareConfig>(defaultShareConfig);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ url: string; provider: string; held: number } | null>(null);
  const [shares, setShares] = useState<ShareListItem[]>([]);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [leftW, setLeftW] = useState(400);
  const [drag, setDrag] = useState(false);
  const reqId = useRef(0);
  const sharesRef = useRef<ShareListItem[]>([]);
  useEffect(() => {
    sharesRef.current = shares;
  }, [shares]);

  // providers
  useEffect(() => {
    let live = true;
    fetch(`/api/share/providers?matterId=${matterId}`)
      .then((r) => r.json())
      .then((d: { providers?: ProviderOption[]; error?: string }) => {
        if (!live) return;
        if (d.error) return setErr(d.error);
        const list = d.providers ?? [];
        setProviders(list);
        setProviderId((cur) => cur ?? list[0]?.contact_id ?? null);
      })
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [matterId]);

  const loadShares = useCallback(async () => {
    const r = await fetch(`/api/share?matterId=${matterId}`, { cache: "no-store" });
    const d = (await r.json()) as { shares?: ShareListItem[] };
    setShares(d.shares ?? []);
  }, [matterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, state lands async
    loadShares().catch(() => null);
  }, [loadShares]);

  // live preview, debounced; stale responses are dropped
  useEffect(() => {
    if (!providerId) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch("/api/share/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matterId, providerContactId: providerId, config }),
        });
        const d = await r.json();
        if (id !== reqId.current) return;
        if (!r.ok) throw new Error(d.error ?? "preview failed");
        setPreview(d as PreviewResp);
        setErr(null);
      } catch (e) {
        if (id === reqId.current) setErr((e as Error).message);
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [matterId, providerId, config]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  // realtime "opened" pings (share_views is anon-readable and carries no case content)
  useEffect(() => {
    const sb = anonClient();
    if (!sb) return;
    const ch = sb
      .channel(`share-views-${matterId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "share_views" }, (payload) => {
        const row = payload.new as { share_id?: string };
        const s = sharesRef.current.find((x) => x.id === row.share_id);
        if (!s) return;
        toast(`${s.provider_name ?? "Provider"} opened the link`);
        loadShares().catch(() => null);
      })
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [matterId, toast, loadShares]);

  // resizable split
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const host = document.querySelector(".gsc-body") as HTMLElement | null;
      const left = host?.getBoundingClientRect().left ?? 0;
      setLeftW(Math.min(Math.max(e.clientX - left, 300), window.innerWidth - 360));
    };
    const up = () => setDrag(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag]);

  const provider = providers.find((p) => p.contact_id === providerId) ?? null;
  const setSection = (s: ShareSection, v: boolean) => setConfig((c) => ({ ...c, sections: { ...c.sections, [s]: v } }));
  const toggleFact = (f: Candidate) =>
    setConfig((c) => ({ ...c, fact_overrides: { ...c.fact_overrides, [f.id]: !f.included } }));
  const addTerm = () => {
    const t = term.trim();
    if (!t) return;
    setConfig((c) => ({ ...c, redact_terms: Array.from(new Set([...c.redact_terms, t])) }));
    setTerm("");
  };

  const publish = async () => {
    if (!providerId) return;
    setPublishing(true);
    setErr(null);
    try {
      const r = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matterId, providerContactId: providerId, config }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "publish failed");
      setPublished({ url: d.url, provider: d.share.provider_name ?? provider?.name ?? "Provider", held: d.findings?.length ?? 0 });
      await loadShares();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch("/api/share", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "revoke" }),
    });
    await loadShares();
    toast("Link revoked. It stops working on the next load.");
  };

  const findingsBySection = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of preview?.findings ?? []) m.set(f.section, (m.get(f.section) ?? 0) + 1);
    return m;
  }, [preview]);

  const providerShares = shares.filter((s) => !providerId || s.provider_contact_id === providerId);

  return (
    <div className={`gsc${className ? ` ${className}` : ""}`}>
      <div className="gsc-top">
        <h2>Share with provider</h2>
        <span className="gsc-sub">Filtered on the server. Deposition-safe by default.</span>
        {onClose && (
          <button className="gsc-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      <div className="gsc-body">
        <div className="gsc-left" style={{ width: leftW }}>
          <div className="gsc-group">
            <span className="gsc-label">Provider</span>
            <select
              value={providerId ?? ""}
              onChange={(e) => {
                setProviderId(Number(e.target.value));
                setPublished(null);
                setConfig((c) => ({ ...c, fact_overrides: {} }));
              }}
            >
              {providers.length === 0 && <option value="">Loading providers</option>}
              {providers.map((p) => (
                <option key={p.contact_id} value={p.contact_id}>
                  {p.name}
                  {p.role ? `  (${p.role.replace(/\s*\(.*\)$/, "")})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="gsc-group">
            <span className="gsc-label">Sections</span>
            {SECTION_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                role="switch"
                aria-checked={config.sections[s]}
                className="gsc-toggle"
                onClick={() => setSection(s, !config.sections[s])}
              >
                <span className="gsc-toggle__txt">
                  <span>
                    {SECTION_LABELS[s].title}
                    {findingsBySection.get(s) ? (
                      <span className="gsc-finding-count" style={{ color: "var(--gs-red)", marginLeft: 6, fontSize: 12 }}>
                        {findingsBySection.get(s)} held back
                      </span>
                    ) : null}
                  </span>
                  <small>{SECTION_LABELS[s].hint}</small>
                </span>
                <span className="gsc-switch" aria-hidden />
              </button>
            ))}
          </div>

          <div className="gsc-group">
            <span className="gsc-label">Coverage detail</span>
            <div className="gsc-seg" role="group">
              {(["hidden", "tier", "exact"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={config.coverage_detail === v}
                  onClick={() => setConfig((c) => ({ ...c, coverage_detail: v }))}
                >
                  {v === "hidden" ? "Hidden" : v === "tier" ? "Tier only" : "Exact"}
                </button>
              ))}
            </div>
          </div>

          <div className="gsc-group">
            <span className="gsc-label">Redact terms</span>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addTerm();
              }}
            >
              <input type="text" value={term} placeholder="Add a word or name, press enter" onChange={(e) => setTerm(e.target.value)} />
            </form>
            {config.redact_terms.length > 0 && (
              <div className="gsc-chips">
                {config.redact_terms.map((t) => (
                  <span key={t} className="gsc-chip">
                    {t}
                    <button
                      type="button"
                      aria-label={`Remove ${t}`}
                      onClick={() => setConfig((c) => ({ ...c, redact_terms: c.redact_terms.filter((x) => x !== t) }))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="gsc-group">
            <span className="gsc-label">Facts in updates ({preview?.candidates.filter((c) => c.included).length ?? 0} on)</span>
            {!config.sections.updates && (
              <span className="gsc-share__meta">Updates section is off, so none of these are sent.</span>
            )}
            <div className="gsc-facts">
              {(preview?.candidates ?? []).length === 0 && (
                <span className="gsc-share__meta">No verified provider-safe facts yet. Strategy, value, prior injuries and other providers never appear here.</span>
              )}
              {(preview?.candidates ?? []).map((f) => (
                <button key={f.id} type="button" role="checkbox" aria-checked={f.included} className="gsc-fact" onClick={() => toggleFact(f)}>
                  <span className="gsc-fact__box" aria-hidden />
                  <span>
                    {f.summary}
                    <span className="gsc-fact__meta">
                      {f.date ? `${fmtDate(f.date)} · ` : ""}
                      {f.kind} · {f.audience === "provider_safe" ? "provider-safe" : "internal"}
                      {f.overridden ? " · overridden" : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="gsc-gate">
            <div className="gsc-gate__head">
              <span>Redaction gate (Jev)</span>
              <span>
                {preview
                  ? `${preview.gate.checked} snippets checked · ${preview.gate.engine === "fallback" ? "fallback classifier" : preview.gate.engine} · ${preview.gate.ms}ms`
                  : "checking"}
              </span>
            </div>
            {preview && preview.findings.length === 0 && <span className="gsc-gate__ok">Nothing held back. Every outgoing line cleared.</span>}
            {preview?.findings.map((f) => (
              <div key={f.key} className="gsc-finding">
                <b>
                  Held back: {f.reason} ({Math.round(f.score * 100)}%)
                </b>
                <q>{f.text}</q>
              </div>
            ))}
          </div>

          {err && <div className="gsc-err">{err}</div>}

          <button className="gsc-btn" disabled={!providerId || publishing} onClick={publish}>
            {publishing ? "Publishing" : published ? "Publish another link" : "Publish link"}
          </button>

          {published && (
            <div className="gsc-published">
              <QRCodeSVG value={published.url} size={112} marginSize={0} />
              <div style={{ minWidth: 0 }}>
                <div>Link ready for {published.provider}</div>
                <div className="gsc-published__url">{published.url}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="gsc-btn gsc-btn--ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => navigator.clipboard?.writeText(published.url)}>
                    Copy
                  </button>
                  <a className="gsc-btn gsc-btn--ghost" style={{ padding: "6px 10px", fontSize: 12, textDecoration: "none" }} href={published.url} target="_blank" rel="noreferrer" data-router-disabled>
                    Open
                  </a>
                </div>
                {published.held > 0 && <div className="gsc-share__meta" style={{ marginTop: 6 }}>{published.held} lines held back by the gate</div>}
              </div>
            </div>
          )}

          <div className="gsc-group">
            <span className="gsc-label">Share log{provider ? ` for ${provider.name}` : ""}</span>
            {providerShares.length === 0 && <span className="gsc-share__meta">No links yet.</span>}
            <div className="gsc-log">
              {providerShares.map((s) => (
                <div key={s.id} className="gsc-share">
                  <div className="gsc-share__row">
                    <span>
                      <span className={`gsc-state is-${s.state}`}>{s.state}</span>{" "}
                      {s.view_count ? `Opened ${s.view_count}x, last ${timeOf(s.last_viewed_at)}` : "Not opened yet"}
                    </span>
                    {s.state === "active" && (
                      <button className="gsc-btn gsc-btn--danger" onClick={() => revoke(s.id)}>
                        Revoke
                      </button>
                    )}
                  </div>
                  <span className="gsc-share__meta">
                    Created {fmtDate(s.created_at, { month: "short", day: "numeric" })} {timeOf(s.created_at)}
                    {s.expires_at && s.state === "active" ? ` · expires ${fmtDate(s.expires_at, { month: "short", day: "numeric" })}` : ""}
                    {s.revoked_at ? ` · revoked ${timeOf(s.revoked_at)}` : ""}
                  </span>
                  {s.views.length > 0 && (
                    <span className="gsc-share__meta">
                      {s.views.slice(0, 4).map((v) => `${v.device} ${timeOf(v.viewed_at)}`).join(" · ")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview"
          className={`gsc-divider${drag ? " is-drag" : ""}`}
          onPointerDown={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
        />

        <div className="gsc-right">
          <div className="gsc-phone-bar">
            <span>Exactly what {provider?.name ?? "the provider"} will see</span>
            <span className={busy ? "gsc-busy" : ""}>{busy ? "Updating" : "Live preview"}</span>
          </div>
          <div className="gs-wrap">
            {preview ? (
              <ProviderViewCard view={preview.view} mode="preview" />
            ) : (
              <p className="gs-empty" style={{ padding: 24 }}>
                {providers.length ? "Building preview" : "Loading"}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="gsc-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="gsc-toast">
            <span className="gs-pulse" aria-hidden>
              <span />
            </span>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Drop-in sheet: `<ShareSheet matterId={id} open={open} onClose={() => setOpen(false)} />`. */
export function ShareSheet({ open, onClose, ...props }: ShareComposerProps & { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="gsc-sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <ShareComposer {...props} onClose={onClose} />
    </div>
  );
}
