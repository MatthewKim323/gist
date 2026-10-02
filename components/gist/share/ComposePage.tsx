"use client";

// Standalone composer host for /s/compose?matterId=. Picks the first synced matter when none is given.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ShareComposer from "./ShareComposer";

export default function ComposePage() {
  const q = useSearchParams();
  const fromUrl = Number(q.get("matterId")) || null;
  const provider = Number(q.get("providerId")) || undefined;
  const [matterId, setMatterId] = useState<number | null>(fromUrl);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (fromUrl) return;
    fetch("/api/share/providers")
      .then((r) => r.json())
      .then((d: { matters?: { id: number }[]; error?: string }) => {
        if (d.matters?.[0]) setMatterId(Number(d.matters[0].id));
        else setErr(d.error ?? "No synced matters yet.");
      })
      .catch((e) => setErr(String(e)));
  }, [fromUrl]);
  if (!matterId) return <p className="gs-empty" style={{ padding: 24 }}>{err ?? "Loading matter"}</p>;
  return <ShareComposer matterId={matterId} initialProviderId={provider} />;
}
