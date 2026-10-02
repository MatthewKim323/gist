// Shapes shared by the provider respond form and the firm inbox (client safe, no server imports).
export type SubmissionKind = "record" | "bill" | "note";
export type SubmissionStatus = "pending" | "accepted" | "dismissed";

export interface ProviderSubmissionLite {
  id: string;
  gate_requirement_key: string | null;
  item_label: string | null;
  kind: SubmissionKind;
  note: string | null;
  file_name: string | null;
  status: SubmissionStatus;
  created_at: string;
}

/** How the provider page is allowed to post: a share token, or the signed-in provider session + matter. */
export interface RespondAuth {
  token?: string;
  matterId?: number;
  submissions: ProviderSubmissionLite[];
}

export interface FirmSubmission extends ProviderSubmissionLite {
  matter_id: number;
  provider_contact_id: number;
  provider_name: string | null;
  size: number | null;
  reviewed_at: string | null;
  url: string | null;
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  const same = new Date().toDateString() === d.toDateString();
  return same
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const STATUS_TEXT: Record<SubmissionStatus, string> = {
  pending: "pending review",
  accepted: "accepted by the firm",
  dismissed: "closed by the firm",
};
