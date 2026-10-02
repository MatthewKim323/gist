"use client";
// Sign-in = pick or create a profile (table `profiles`). Demo-grade: no passwords. The chosen profile is
// signed into the gist_session cookie; proxy.ts and requireRole() enforce the role server-side.
import { useState } from "react";
import FillButton from "./FillButton";
import Avatar from "@/components/gist/profile/Avatar";
import ProfileFields, { type Fields } from "@/components/gist/profile/ProfileFields";
import "./auth.css";
import "@/app/styles/gist-profile.css";

export interface OfficeOption {
  contact_id: number;
  name: string;
  cases: number;
}

export interface RecentProfile {
  id: string;
  role: "firm" | "provider";
  display_name: string;
  title: string | null;
  firm_name: string | null;
  provider_contact_id: number | null;
  avatar_color: string | null;
  last_seen_at: string;
}

async function signIn(body: Record<string, unknown>): Promise<string> {
  const r = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { next?: string; error?: string };
  if (!r.ok || !j.next) throw new Error(j.error ?? "Sign-in failed");
  return backTo(j.next);
}

/** Honor /signin?next=<path> (set by the auth redirects) when it is local and fits the role's home. */
function backTo(home: string): string {
  const want = new URLSearchParams(window.location.search).get("next");
  if (!want || !want.startsWith("/") || want.startsWith("//") || want.startsWith("/signin")) return home;
  const providerPath = /^\/(provider|profile|s\/(?!compose))/.test(want);
  const firmOnly = /^\/(cases|matter|s\/compose|pipeline-preview)(\/|\?|$)/.test(want);
  if (home === "/provider") return providerPath ? want : home;
  return want.startsWith("/provider") ? home : firmOnly || want.startsWith("/profile") ? want : home;
}

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

type Mode = "pick" | "firm-new" | "provider-office" | "provider-new";

export default function SignInChoices({
  offices,
  current,
  firmRecent,
  providerRecent,
  firmPrefill,
}: {
  offices: OfficeOption[];
  current: string | null;
  firmRecent: RecentProfile[];
  providerRecent: RecentProfile[];
  firmPrefill: Fields;
}) {
  const [mode, setMode] = useState<Mode>("pick");
  const [office, setOffice] = useState<number | null>(offices.length === 1 ? offices[0]!.contact_id : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [firm, setFirm] = useState<Fields>({ ...firmPrefill, title: firmPrefill.title || "Attorney" });
  const [prov, setProv] = useState<Fields>({ display_name: "", email: "", title: "", firm_name: "" });

  const go = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      // Full navigation so the new cookie applies to every request (the engine router does client pushes).
      window.location.assign(await signIn(body));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const to = (m: Mode) => {
    setErr(null);
    setMode(m);
  };

  const chosen = offices.find((o) => o.contact_id === office);
  const officeName = (id: number | null) => offices.find((o) => o.contact_id === id)?.name ?? null;
  const liveProviders = providerRecent.filter((p) => officeName(p.provider_contact_id));

  const people = (list: RecentProfile[], meta: (p: RecentProfile) => string) => (
    <ul className="gp-people" aria-label="Continue as">
      {list.map((p) => (
        <li key={p.id}>
          <button type="button" className="gp-person" disabled={busy} onClick={() => go({ profileId: p.id })}>
            <Avatar name={p.display_name} color={p.avatar_color} />
            <span className="gp-person__txt">
              <span className="gp-person__name">Continue as {p.display_name}</span>
              <span className="gp-person__meta">{meta(p)}</span>
            </span>
            <span className="gp-person__go">{ago(p.last_seen_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="ga-choices">
      {current && <p className="ga-note">Signed in as {current}. Pick again to switch.</p>}

      {mode === "pick" && (
        <div className="ga-grid">
          <section className="ga-card">
            <div className="gs-eyebrow">Law firm</div>
            <h2 className="ga-card__title">I&apos;m with the firm</h2>
            <p className="ga-card__body">The full case: digest, gaps, money, timeline, and what you share with each provider.</p>
            {firmRecent.length > 0 && (
              people(firmRecent.slice(0, 4), (p) => [p.title, p.firm_name].filter(Boolean).join(", ") || "Firm")
            )}
            <FillButton label={firmRecent.length ? "New profile" : "Create my profile"} disabled={busy} onClick={() => to("firm-new")} />
          </section>
          <section className="ga-card">
            <div className="gs-eyebrow">Medical provider</div>
            <h2 className="ga-card__title">I&apos;m a treating provider</h2>
            <p className="ga-card__body">Status of the cases you treat on a lien. Only what the firm chose to share.</p>
            {liveProviders.length > 0 && (
              people(liveProviders.slice(0, 4), (p) => [p.title, officeName(p.provider_contact_id)].filter(Boolean).join(", "))
            )}
            <FillButton
              label={liveProviders.length ? "New profile" : "Find my office"}
              disabled={busy || !offices.length}
              onClick={() => to("provider-office")}
            />
            {!offices.length && <p className="ga-note">No provider offices found on synced cases yet.</p>}
          </section>
        </div>
      )}

      {mode === "firm-new" && (
        <section className="ga-card ga-card--wide">
          <div className="gs-eyebrow">Law firm</div>
          <h2 className="ga-card__title">Your profile</h2>
          <p className="ga-card__body">Your firm name is what treating providers see on the status pages you share.</p>
          <ProfileFields role="firm" value={firm} onChange={setFirm} />
          <div className="ga-row">
            <FillButton
              key={firm.display_name.trim() ? "go" : "name"}
              label={firm.display_name.trim() ? "Create and open my cases" : "Add your name"}
              disabled={busy || !firm.display_name.trim()}
              onClick={() => go({ role: "firm", ...firm })}
            />
            <button type="button" className="ga-link" onClick={() => to("pick")}>
              Back
            </button>
          </div>
        </section>
      )}

      {mode === "provider-office" && (
        <section className="ga-card ga-card--wide">
          <div className="gs-eyebrow">Medical provider</div>
          <h2 className="ga-card__title">Which office are you?</h2>
          <ul className="ga-list" role="radiogroup" aria-label="Your office">
            {offices.map((o) => (
              <li key={o.contact_id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={office === o.contact_id}
                  className={`ga-office${office === o.contact_id ? " is-on" : ""}`}
                  onClick={() => setOffice(o.contact_id)}
                >
                  <span>{o.name}</span>
                  <span className="ga-office__meta">
                    {o.cases} case{o.cases === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="ga-row">
            <FillButton
              key={chosen ? "go" : "pick"}
              label={chosen ? "Continue" : "Pick your office"}
              disabled={busy || !chosen}
              onClick={() => chosen && to("provider-new")}
            />
            <button type="button" className="ga-link" onClick={() => to("pick")}>
              Back
            </button>
          </div>
        </section>
      )}

      {mode === "provider-new" && chosen && (
        <section className="ga-card ga-card--wide">
          <div className="gs-eyebrow">{chosen.name}</div>
          <h2 className="ga-card__title">Who&apos;s checking in?</h2>
          <ProfileFields role="provider" value={prov} onChange={setProv} office={chosen.name} />
          <div className="ga-row">
            <FillButton
              key={prov.display_name.trim() ? "go" : "name"}
              label={prov.display_name.trim() ? "Create and see my cases" : "Add your name"}
              disabled={busy || !prov.display_name.trim()}
              onClick={() =>
                go({ role: "provider", providerContactId: chosen.contact_id, display_name: prov.display_name, email: prov.email, title: prov.title })
              }
            />
            <button type="button" className="ga-link" onClick={() => to("provider-office")}>
              Back
            </button>
          </div>
        </section>
      )}

      {err && <p className="ga-err">{err}</p>}
    </div>
  );
}
