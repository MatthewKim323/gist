"use client";

// Small chip on a gate row when the agent has a draft waiting for that requirement.
import "@/app/styles/gist-actions.css";
import { focusDraft, useActions } from "./store";

export default function DraftChip({ matterId, requirementKey, fixture }: { matterId: number | null; requirementKey: string; fixture?: boolean }) {
  const { rows } = useActions(fixture ? null : matterId);
  const hit = rows?.find((r) => (r.status === "proposed" || r.status === "approved") && (r.covers ?? []).includes(requirementKey));
  if (!hit) return null;
  return (
    <button type="button" className={`gact-chip is-${hit.status}`} onClick={() => focusDraft(hit.id)} title={`Draft to ${hit.recipient_name ?? "recipient"}`}>
      {hit.status === "approved" ? "Draft approved" : "Draft ready"}
    </button>
  );
}
