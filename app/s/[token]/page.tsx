// Provider-facing share page. Server component: the token is checked by hash, the view is built and
// gated on the server, and only the filtered payload is rendered. Nothing hidden reaches the phone.
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import ProviderViewCard from "@/components/gist/share/ProviderViewCard";
import VoiceButton from "@/components/gist/voice/VoiceButton";
import { cachedGatedView, logView, lookupShare, stageNotice } from "@/lib/server/share";
import { normalizeConfig } from "@/lib/server/share/plain";
import { listForProvider } from "@/lib/server/submissions";
import { caseUpdates } from "@/lib/server/autopilot/updates";
import "@/app/styles/gist-share.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Case status",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const viewport: Viewport = { themeColor: "#0b0f19", width: "device-width", initialScale: 1 };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main data-router-view="notFound" data-body-class="dark gist-share-body" role="main" className="gs-root">
      <div className="gs-wrap">{children}</div>
    </main>
  );
}

function Closed({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div className="gs-closed">
        <div className="gs-closed__icon" aria-hidden />
        <h1 className="gs-title">{title}</h1>
        <p>{body}</p>
        <p className="gs-foot">gist. Read-only provider status.</p>
      </div>
    </Shell>
  );
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await lookupShare(token);
  if (!found.ok) {
    if (found.reason === "revoked")
      return <Closed title="Link revoked" body="The firm turned this link off. Please contact the firm directly for a new one." />;
    if (found.reason === "expired")
      return <Closed title="Link expired" body="This status link has expired. Please ask the firm for a fresh link." />;
    return <Closed title="Link not found" body="This link is not valid. Check that the whole address was copied." />;
  }
  const share = found.share;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip");
  // Log first so the attorney's "opened" toast fires while the page is still building.
  await logView(share, ip || null, h.get("user-agent")).catch(() => null);
  const loaded = await Promise.all([
    // Decisions saved at publish answer instantly; anything new since then gets a short timeout and fails closed.
    cachedGatedView(Number(share.matter_id), Number(share.provider_contact_id), normalizeConfig(share.config), {
      memo: share.config._gate,
      timeoutMs: 2500,
    }),
    stageNotice(share).catch(() => null),
    listForProvider(Number(share.matter_id), Number(share.provider_contact_id)).catch(() => []),
    caseUpdates({ shareId: share.id }).catch(() => []),
  ]).catch(() => null);
  if (!loaded)
    return <Closed title="Status unavailable" body="The firm's status page could not load right now. Please try again in a minute." />;
  const [gated, notice, mine, moves] = loaded;
  return (
    <Shell>
      <div className="gv-provider-cta">
        <VoiceButton mode="provider" token={token} />
      </div>
      <ProviderViewCard view={gated.view} mode="live" stageNotice={notice} caseMoves={moves} respond={{ token, submissions: mine }} />
    </Shell>
  );
}
