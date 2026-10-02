"use client";

// Badge on a gate row when a provider has answered that requirement (pending or accepted).
import "@/app/styles/gist-submissions.css";
import { useSubmissions } from "./store";

export default function GateBadge({ matterId, requirementKey, fixture }: { matterId: number | null; requirementKey: string; fixture?: boolean }) {
  const rows = useSubmissions(fixture ? null : matterId);
  const hit = rows?.find((r) => r.gate_requirement_key === requirementKey && r.status !== "dismissed");
  if (!hit) return null;
  const who = hit.provider_name ?? "provider";
  return (
    <span className={`gsub-badge is-${hit.status}`} title={hit.file_name ?? hit.note ?? undefined}>
      {hit.status === "accepted" ? `Received from ${who} · accepted, add to Clio` : `Received from ${who} · pending review`}
    </span>
  );
}
