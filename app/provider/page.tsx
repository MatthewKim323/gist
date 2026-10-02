// Provider portal. Server component: the role comes from the signed session, the view is built and
// gated by buildProviderView on the server with the firm's share config, and only that filtered
// payload is rendered. A provider can never pick a config or another office from here.
import type { Metadata } from "next";
import ProviderViewCard from "@/components/gist/share/ProviderViewCard";
import SessionChip from "@/components/gist/auth/SessionChip";
import VoiceButton from "@/components/gist/voice/VoiceButton";
import "@/components/gist/auth/auth.css";
import { requireRole } from "@/lib/server/auth/session";
import { findOffice } from "@/lib/server/auth/offices";
import { db } from "@/lib/server/db";
import { cachedGatedView, type ShareRow } from "@/lib/server/share";
import { defaultShareConfig, normalizeConfig } from "@/lib/server/share/plain";
import { listForProvider } from "@/lib/server/submissions";
import { withFirmName } from "@/lib/server/share/firm";
import { caseUpdates } from "@/lib/server/autopilot/updates";
import "@/app/styles/gist-share.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your cases", robots: { index: false, follow: false } };

/** The attorney's latest live share for this office on this case, if any. */
async function latestShare(matterId: number, contactId: number): Promise<ShareRow | null> {
  const { data } = await db()
    .from("shares")
    .select("*")
    .eq("matter_id", matterId)
    .eq("provider_contact_id", contactId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const now = Date.now();
  return ((data ?? []) as ShareRow[]).find((s) => !s.expires_at || new Date(s.expires_at).getTime() > now) ?? null;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main data-router-view="notFound" data-body-class="dark gist-share-body" role="main" className="gs-root">
      <div className="gs-wrap">{children}</div>
    </main>
  );
}

export default async function ProviderPortal({ searchParams }: { searchParams: Promise<{ case?: string }> }) {
  const session = await requireRole("provider");
  const contactId = Number(session.providerContactId);
  const office = await findOffice(contactId);
  const chip = <SessionChip initial={{ role: "provider", name: session.name }} />;

  if (!office || !office.cases.length)
    return (
      <Frame>
        <div className="ga-top">{chip}</div>
        <div className="gs-closed">
          <h1 className="gs-title">No open cases</h1>
          <p>Your office is not listed on any case right now. Your firm controls what appears here.</p>
        </div>
      </Frame>
    );

  const want = Number((await searchParams).case);
  const current = office.cases.find((c) => c.matter_id === want) ?? office.cases[0]!;
  const share = await latestShare(current.matter_id, contactId).catch(() => null);
  // Never shared with this office: the conservative default (no case updates) until the firm publishes a scope.
  const config = share ? normalizeConfig(share.config) : defaultShareConfig();
  const gated = await cachedGatedView(current.matter_id, contactId, config, {
    memo: share?.config._gate,
    timeoutMs: 2500,
  }).catch(() => null);
  const mine = await listForProvider(current.matter_id, contactId).catch(() => []);
  const moves = share ? await caseUpdates({ matterId: current.matter_id, providerContactId: contactId }).catch(() => []) : [];

  return (
    <Frame>
      <div className="ga-top">
        <div className="gs-eyebrow">
          {office.cases.length} case{office.cases.length === 1 ? "" : "s"} for {office.name}
        </div>
        {chip}
      </div>
      {office.cases.length > 1 && (
        <nav className="ga-cases" aria-label="Your cases">
          {office.cases.map((c) => (
            <a
              key={c.matter_id}
              href={`/provider?case=${c.matter_id}`}
              data-router-disabled
              className={`ga-case${c.matter_id === current.matter_id ? " is-on" : ""}`}
            >
              {c.display_number ?? `Case ${c.matter_id}`}
            </a>
          ))}
        </nav>
      )}
      {gated ? (
        <div className="gv-provider-cta">
          <VoiceButton mode="provider" matterId={current.matter_id} />
        </div>
      ) : null}
      {gated ? (
        <ProviderViewCard view={await withFirmName(gated.view, share?.created_by)} mode="live" caseMoves={moves} respond={{ matterId: current.matter_id, submissions: mine }} />
      ) : (
        <div className="gs-closed">
          <h1 className="gs-title">Status unavailable</h1>
          <p>The firm&apos;s status page could not load right now. Please try again in a minute.</p>
        </div>
      )}
      {!share && <p className="gs-foot">Your firm controls what appears here.</p>}
    </Frame>
  );
}
