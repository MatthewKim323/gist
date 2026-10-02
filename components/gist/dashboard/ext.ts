// Optional fields the digest API sends beyond lib/types Digest. All guarded: absent in older digests.
import type { Cited, Digest } from "@/lib/types";

export interface DigestExtras {
  matter?: { sol?: { date: Cited<string> | null; satisfied: boolean | null; days_remaining: number | null } | null };
  money?: {
    wage_loss?: Cited<number> | null;
    coverage_lines?: { label: string; raw?: string; per_person: number | null; per_occurrence: number | null }[];
  };
  last_client_contact_detail?: {
    channel?: string | null;
    days_ago?: number | null;
    last_written_from_client?: Cited<string> | null;
  } | null;
  providers?: { billed?: Cited<number> | null }[];
}

export const extras = (d: Digest) => d as unknown as DigestExtras;
