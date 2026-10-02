import "server-only";
// The firm name a provider sees: the sharing attorney's profile firm_name (shares.created_by holds the
// profile id), else the most recently active firm profile, else GIST_FIRM_NAME, else what the view had.
import { firmNameFor } from "@/lib/server/profiles";

export async function withFirmName<T extends { firm_name: string | null }>(view: T, createdBy?: string | null): Promise<T> {
  const firm_name = await firmNameFor({ createdBy, fallback: view.firm_name }).catch(() => view.firm_name);
  return { ...view, firm_name };
}
