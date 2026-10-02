"use client";
// Sign-in, inside the landing's contact scene (the camera turns to it with the toContact transition). Firm
// sign-in drops straight into the run: the engine seam-wipes /contact -> /matter. Providers get a full load of
// their portal. Same session API as /signin; that page stays as the plain fallback.
import { useEffect, useState } from "react";

type Row = { id: string; display_name: string; firm_name: string | null; title: string | null };
type Choices = { firm: Row[]; provider: Row[]; offices: { contact_id: number; name: string }[]; prefill: { display_name: string; email: string; firm_name: string } };

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { next?: string; error?: string };
  if (!r.ok) throw new Error(j.error ?? "Sign-in failed");
  return j.next ?? "/";
}

/** Firm: hand the route change to the engine so the scene seam-wipes into the pipeline timeline. */
function submerge() {
  const hw = (window as unknown as { store?: { Highway?: { redirect?: (u: string, t?: string) => boolean } } }).store?.Highway;
  if (!hw?.redirect?.("/matter", "toMatter")) window.location.assign("/matter");
}

export default function SceneSignIn() {
  const [side, setSide] = useState<"firm" | "provider">("firm");
  const [c, setC] = useState<Choices | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/choices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setC(j as Choices))
      .catch(() => {});
  }, []);

  const go = async (key: string, body: Record<string, unknown>, role: "firm" | "provider") => {
    setBusy(key);
    setErr(null);
    try {
      const next = await post(body);
      if (role === "firm") submerge();
      else window.location.assign(next);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  const firmRows: { key: string; title: string; sub: string; body: Record<string, unknown> }[] = c
    ? c.firm.length
      ? c.firm.map((p) => ({ key: p.id, title: p.display_name, sub: p.firm_name ?? p.title ?? "Firm", body: { profileId: p.id } }))
      : c.prefill.display_name
        ? [{ key: "new", title: c.prefill.display_name, sub: c.prefill.firm_name || "Firm", body: { role: "firm", ...c.prefill } }]
        : []
    : [];
  const providerRows = c
    ? [
        ...c.provider.map((p) => ({ key: p.id, title: p.display_name, sub: p.title ?? "Provider office", body: { profileId: p.id } as Record<string, unknown> })),
        ...c.offices
          .filter((o) => !c.provider.some((p) => p.display_name === o.name))
          .map((o) => ({ key: `o${o.contact_id}`, title: o.name, sub: "Treating provider", body: { role: "provider", providerContactId: o.contact_id, display_name: o.name } as Record<string, unknown> })),
      ].slice(0, 4)
    : [];
  const rows = side === "firm" ? firmRows : providerRows;

  return (
    <div className="ssi">
      <div className="ssi__tabs" role="tablist">
        {(["firm", "provider"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={side === s} className="ssi__tab" data-on={side === s ? "" : undefined} onClick={() => setSide(s)} data-router-disabled="">
            {s === "firm" ? "Law firm" : "Medical provider"}
          </button>
        ))}
      </div>
      <div className="ssi__list">
        {!c ? <div className="ssi__hint">Loading profiles…</div> : null}
        {c && !rows.length ? <div className="ssi__hint">No {side === "firm" ? "firm profiles" : "provider offices"} yet.</div> : null}
        {rows.map((r) => (
          <button key={r.key} type="button" className="ssi__row" disabled={!!busy} onClick={() => go(r.key, r.body, side)} data-router-disabled="">
            <span className="ssi__avatar">{r.title.slice(0, 1)}</span>
            <span className="ssi__who">
              <span className="ssi__name">{r.title}</span>
              <span className="ssi__sub">{r.sub}</span>
            </span>
            <span className="ssi__go">{busy === r.key ? "Opening…" : side === "firm" ? "Open the case ↘" : "Open portal ↘"}</span>
          </button>
        ))}
      </div>
      {err ? <div className="ssi__err">{err}</div> : null}
      <a className="ssi__more" href="/signin" data-router-disabled="">
        Someone else? Create a profile
      </a>
    </div>
  );
}
