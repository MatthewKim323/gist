// Role picker. Demo-grade on purpose: no passwords. Picking a role writes a signed, httpOnly
// session cookie; proxy.ts and requireRole() enforce it server-side from then on.
import type { Metadata } from "next";
import SignInChoices from "@/components/gist/auth/SignInChoices";
import { getSession } from "@/lib/server/auth/session";
import { listOffices } from "@/lib/server/auth/offices";
import "@/app/styles/gist-share.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function SignInPage() {
  const [session, offices] = await Promise.all([getSession(), listOffices().catch(() => [])]);
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
        />
        <p className="gs-foot" style={{ marginTop: "2rem" }}>
          Demo sign-in: roles are picked, not password-protected. Access is still enforced on the server.
        </p>
      </div>
    </main>
  );
}
