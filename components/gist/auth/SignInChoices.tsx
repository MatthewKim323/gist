"use client";
import { useState } from "react";
import FillButton from "./FillButton";
import "./auth.css";

export interface OfficeOption {
  contact_id: number;
  name: string;
  cases: number;
}

async function signIn(body: Record<string, unknown>): Promise<string> {
  const r = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { next?: string; error?: string };
  if (!r.ok || !j.next) throw new Error(j.error ?? "Sign-in failed");
  return j.next;
}

export default function SignInChoices({ offices, current }: { offices: OfficeOption[]; current: string | null }) {
  const [mode, setMode] = useState<"pick" | "provider">("pick");
  const [office, setOffice] = useState<number | null>(offices.length === 1 ? offices[0]!.contact_id : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  const chosen = offices.find((o) => o.contact_id === office);

  return (
    <div className="ga-choices">
      {current && <p className="ga-note">Signed in as {current}. Pick again to switch.</p>}
      {mode === "pick" ? (
        <div className="ga-grid">
          <section className="ga-card">
            <div className="gs-eyebrow">Law firm</div>
            <h2 className="ga-card__title">I&apos;m with the firm</h2>
            <p className="ga-card__body">The full case: digest, gaps, money, timeline, and what you share with each provider.</p>
            <FillButton label="Open the case" disabled={busy} onClick={() => go({ role: "firm" })} />
          </section>
          <section className="ga-card">
            <div className="gs-eyebrow">Medical provider</div>
            <h2 className="ga-card__title">I&apos;m a treating provider</h2>
            <p className="ga-card__body">Status of the cases you treat on a lien. Only what the firm chose to share.</p>
            <FillButton label="Find my office" disabled={busy || !offices.length} onClick={() => setMode("provider")} />
            {!offices.length && <p className="ga-note">No provider offices found on synced cases yet.</p>}
          </section>
        </div>
      ) : (
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
              onClick={() => chosen && go({ role: "provider", providerContactId: chosen.contact_id })}
            />
            <button type="button" className="ga-link" onClick={() => setMode("pick")}>
              Back
            </button>
          </div>
        </section>
      )}
      {err && <p className="ga-err">{err}</p>}
    </div>
  );
}
