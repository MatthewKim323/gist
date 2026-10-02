// Sign-in: pick a recent profile or create one (table `profiles`). Demo-grade on purpose: no passwords.
// The chosen profile is written to a signed, httpOnly session cookie; proxy.ts and requireRole() enforce it.
import type { Metadata } from "next";
import SignInChoices from "@/components/gist/auth/SignInChoices";
import { getSession } from "@/lib/server/auth/session";
import { listOffices } from "@/lib/server/auth/offices";
import { recentProfiles } from "@/lib/server/profiles";
import { firmDefaults } from "@/lib/server/profiles/firm-defaults";
import "@/app/styles/gist-share.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

const lite = (p: Awaited<ReturnType<typeof recentProfiles>>[number]) => ({
  id: p.id,
  role: p.role,
  display_name: p.display_name,
  title: p.title,
  firm_name: p.firm_name,
  provider_contact_id: p.provider_contact_id === null ? null : Number(p.provider_contact_id),
  avatar_color: p.avatar_color,
  last_seen_at: p.last_seen_at,
});

export default async function SignInPage() {
  const [session, offices, firmRecent, providerRecent, prefill] = await Promise.all([
    getSession(),
    listOffices().catch(() => []),
    recentProfiles("firm").catch(() => []),
    recentProfiles("provider").catch(() => []),
    firmDefaults().catch(() => ({ display_name: "", email: "", firm_name: "" })),
  ]);
  return (
    <main data-router-view="notFound" data-body-class="dark gist-share-body" role="main" className="gs-root">
      <div className="gs-wrap" style={{ maxWidth: 980 }}>
        <header className="gs-head" style={{ marginBottom: "2rem" }}>
          <div className="gs-eyebrow">gist</div>
          <h1 className="gs-title">Who&apos;s opening the case?</h1>
          <p className="gs-sub">One case, two sides. Each sees only what is theirs.</p>
        </header>
        <SignInChoices
          current={session?.name ?? null}
          offices={offices.map((o) => ({ contact_id: o.contact_id, name: o.name, cases: o.cases.length }))}
          firmRecent={firmRecent.map(lite)}
          providerRecent={providerRecent.map(lite)}
          firmPrefill={{ ...prefill, title: "" }}
        />
        <p className="gs-foot" style={{ marginTop: "2rem" }}>
          Demo sign-in: profiles are picked, not password-protected. Access is still enforced on the server.
        </p>
      </div>
    </main>
  );
}
