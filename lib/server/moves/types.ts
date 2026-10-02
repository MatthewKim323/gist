// Next-move contracts, shared by the server (nextMoves, API, assistant) and the client cards. Types only.
import type { Citation, Owner } from "@/lib/types";

export type MoveStatus = "todo" | "in_progress" | "done" | "dismissed";
export type MoveActionKind = "open_draft" | "open_share" | "review_upload" | "open_tab" | "mark_done";

export interface MoveAction {
  kind: MoveActionKind;
  label: string;
  payload: {
    actionId?: string | null;
    requirementKeys?: string[];
    providerId?: number;
    submissionId?: string;
    url?: string | null;
    tab?: string;
  };
}

export interface Move {
  /** stable key, e.g. records:123, client:followup, share:123, review:<uuid>, flags:depo, demand:limits */
  id: string;
  title: string;
  why: string;
  /** e.g. "unblocks 2 of 24 for Trial" */
  unblocks: string | null;
  party: string | null;
  owner: Owner | null;
  priority: number;
  cites: Citation[];
  primary: MoveAction;
  secondary: MoveAction[];
  status: MoveStatus;
  /** what happened, once done ("Draft approved", "Share link live") */
  note: string | null;
  /** status came from the underlying record (draft approved, share exists, upload accepted) */
  auto: boolean;
}

export interface MovesResult {
  matterId: number;
  client: string;
  current_phase: string;
  next_phase: string | null;
  gates_have: number;
  gates_total: number;
  moves: Move[];
  open: number;
  done: number;
}
