"use client";
// /profile: view and edit your own profile. Role and office are read-only (they decide what you may see).
import { useState } from "react";
import Button from "@/components/gist/ui/Button";
import Avatar from "./Avatar";
import ProfileFields, { type Fields } from "./ProfileFields";
import { signOut, switchAccount } from "./signout";
import "@/app/styles/gist-profile.css";
import "@/components/gist/auth/auth.css";

export interface ProfileData {
  id: string;
  role: "firm" | "provider";
  display_name: string;
  email: string | null;
  title: string | null;
  firm_name: string | null;
  avatar_color: string | null;
  created_at: string;
}

const nav = (href: string) => (e: React.MouseEvent<HTMLElement>) => {
  // Full page load: the engine router only knows its own views.
  e.preventDefault();
  window.location.assign(href);
};

const toFields = (p: ProfileData): Fields => ({
  display_name: p.display_name,
  email: p.email ?? "",
  title: p.title ?? "",
  firm_name: p.firm_name ?? "",
});

export default function ProfileView({
  initial,
  office,
  clio,
}: {
  initial: ProfileData;
  office: { name: string; cases: number } | null;
  clio: { connected: boolean; name: string | null } | null;
}) {
  const [p, setP] = useState(initial);
  const [f, setF] = useState<Fields>(toFields(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(toFields(p));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, string> = { display_name: f.display_name, email: f.email, title: f.title };
      if (p.role === "firm") body.firm_name = f.firm_name;
      const r = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { profile?: ProfileData; error?: string };
      if (!r.ok || !j.profile) throw new Error(j.error ?? "Could not save");
      setP(j.profile);
      setF(toFields(j.profile));
      setMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const since = new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="gp-page">
      <div className="ga-top" style={{ marginBottom: 0 }}>
        <a className="gs-eyebrow" href={p.role === "firm" ? "/cases" : "/provider"} onClick={nav(p.role === "firm" ? "/cases" : "/provider")} style={{ color: "inherit", textDecoration: "none" }}>
          gist
        </a>
      </div>

      <header className="gp-id">
        <Avatar name={p.display_name} color={p.avatar_color} size="lg" />
        <div>
          <h1 className="gp-id__name">{p.display_name}</h1>
          <p className="gp-id__meta">
            {[p.title, p.role === "firm" ? p.firm_name : office?.name].filter(Boolean).join(", ") || (p.role === "firm" ? "Firm" : "Provider")}
          </p>
        </div>
      </header>

      <section className="ga-card ga-card--wide">
        <div className="gs-eyebrow">Account</div>
        <dl className="gp-facts">
          <div>
            <dt>Role</dt>
            <dd>{p.role === "firm" ? "Law firm staff" : "Treating provider"}</dd>
          </div>
          <div>
            <dt>{p.role === "firm" ? "Clio" : "Office"}</dt>
            <dd>
              {p.role === "firm" ? (
                <span className="gp-status" data-on={clio?.connected ? "1" : "0"}>
                  {clio?.connected ? `Connected${clio.name ? ` as ${clio.name}` : ""}` : "Not connected"}
                </span>
              ) : (
                `${office?.name ?? "Office not on any case"}${office ? `, ${office.cases} case${office.cases === 1 ? "" : "s"}` : ""}`
              )}
            </dd>
          </div>
          <div>
            <dt>Profile since</dt>
            <dd>{since}</dd>
          </div>
        </dl>
        <div className="ga-row">
          {p.role === "firm" ? (
            <>
              <Button href="/cases" onClick={nav("/cases")} arrow>
                Open my cases
              </Button>
              {!clio?.connected && (
                <Button href="/api/clio/connect" onClick={nav("/api/clio/connect")} variant="border" size="sm">
                  Connect Clio
                </Button>
              )}
            </>
          ) : (
            <Button href="/provider" onClick={nav("/provider")} arrow>
              See my cases
            </Button>
          )}
        </div>
      </section>

      <section className="ga-card ga-card--wide">
        <div className="gs-eyebrow">Your details</div>
        {p.role === "firm" && <p className="ga-card__body">Your firm name appears on every status page you share with a provider.</p>}
        <ProfileFields role={p.role} value={f} onChange={setF} office={office?.name ?? null} />
        <div className="ga-row">
          <Button disabled={busy || !dirty || !f.display_name.trim()} onClick={save}>
            {busy ? "Saving" : "Save changes"}
          </Button>
          {msg && <p className={msg.ok ? "gp-ok" : "ga-err"}>{msg.text}</p>}
        </div>
      </section>

      <section className="ga-card ga-card--wide">
        <div className="gs-eyebrow">Session</div>
        <div className="ga-row" style={{ marginTop: 0 }}>
          <Button onClick={() => signOut("/")} variant="border" size="sm">
            Sign out
          </Button>
          <button type="button" className="ga-link" onClick={switchAccount}>
            Switch account
          </button>
        </div>
      </section>
    </div>
  );
}
