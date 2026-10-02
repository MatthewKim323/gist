// Agent action contracts, shared by the server (propose, API) and the dashboard panel. Types only.
import type { Citation, Owner } from "@/lib/types";

export type ActionKind = "records_request" | "client_followup" | "defense_demand" | "carrier_followup" | "internal_task";
export type ActionStatus = "proposed" | "approved" | "dismissed" | "sent_manually";
export type ActionChannel = "email" | "letter" | "call";

export interface AgentAction {
  id: string;
  matter_id: number;
  requirement_key: string;
  kind: ActionKind;
  recipient_name: string | null;
  recipient_contact_id: number | null;
  recipient_email: string | null;
  channel: ActionChannel;
  subject: string;
  body: string;
  rationale: string | null;
  cites: Citation[];
  /** every gate requirement_key (and digest action id) this draft answers */
  covers: string[];
  status: ActionStatus;
  source: "model" | "template";
  edited: boolean;
  created_at: string;
  updated_at: string;
}

export const KIND_FOR_OWNER: Partial<Record<Owner, ActionKind>> = {
  provider: "records_request",
  client: "client_followup",
  defense: "defense_demand",
  carrier: "carrier_followup",
};
