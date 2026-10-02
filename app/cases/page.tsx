// The firm's workspace: connect Clio, pick a case, sync it, open its digest.
// Firm sessions and no session (the demo flow) get in; providers are redirected by proxy.ts.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CasesView from "@/components/gist/cases/CasesView";
import { getSession } from "@/lib/server/auth/session";
import "@/app/styles/gist-cases.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your cases", robots: { index: false, follow: false } };

export default async function CasesPage() {
  const session = await getSession();
  if (session && session.role !== "firm") redirect("/provider");
  return (
    <main data-router-view="notFound" data-body-class="dark gist-cases-body" role="main" className="gc-root">
      <CasesView session={session ? { role: session.role, name: session.name } : null} />
    </main>
  );
}
