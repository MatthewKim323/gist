// Dev host for the share composer: /s/compose?matterId=<id>[&providerId=<contact id>].
// The dashboard mounts the same component as a sheet (ShareSheet from components/gist/share).
import type { Metadata } from "next";
import { Suspense } from "react";
import ComposePage from "@/components/gist/share/ComposePage";
import "@/app/styles/gist-share.css";

export const metadata: Metadata = { title: "Share with provider", robots: { index: false, follow: false } };

export default function Compose() {
  return (
    <main data-router-view="notFound" data-body-class="dark gist-share-body" role="main" className="gs-root" style={{ overflow: "hidden" }}>
      <Suspense>
        <ComposePage />
      </Suspense>
    </main>
  );
}
