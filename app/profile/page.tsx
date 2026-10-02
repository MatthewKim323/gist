// Your profile. Signed-in only (any role); the profile id comes from the signed session cookie.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ProfileView from "@/components/gist/profile/ProfileView";
import NavButton from "@/components/gist/profile/NavButton";
import { getSession } from "@/lib/server/auth/session";
import { findOffice } from "@/lib/server/auth/offices";
import { getProfile } from "@/lib/server/profiles";
import { clioConnection } from "@/lib/server/profiles/firm-defaults";
import "@/app/styles/gist-share.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your profile", robots: { index: false, follow: false } };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main data-router-view="notFound" data-body-class="dark gist-share-body" role="main" className="gs-root">
      <div className="gs-wrap" style={{ maxWidth: 820 }}>{children}</div>
    </main>
  );
}

export default async function ProfilePage() {
  const s = await getSession();
  if (!s) redirect("/signin?next=/profile");
  const p = await getProfile(s.profileId).catch(() => null);
  if (!p)
    return (
      <Frame>
        <div className="gs-closed">
          <h1 className="gs-title">No profile yet</h1>
          <p>This session started before profiles existed. Sign in again to create yours.</p>
          <NavButton href="/signin" arrow>
            Sign in
          </NavButton>
        </div>
      </Frame>
    );
  const [office, clio] = await Promise.all([
    p.role === "provider" ? findOffice(Number(p.provider_contact_id)).catch(() => null) : null,
    p.role === "firm" ? clioConnection().catch(() => null) : null,
  ]);
  return (
    <Frame>
      <ProfileView
        initial={{
          id: p.id,
          role: p.role,
          display_name: p.display_name,
          email: p.email,
          title: p.title,
          firm_name: p.firm_name,
          avatar_color: p.avatar_color,
          created_at: p.created_at,
        }}
        office={office ? { name: office.name, cases: office.cases.length } : null}
        clio={clio}
      />
    </Frame>
  );
}
