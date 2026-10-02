import "server-only";
// Prefill for a new firm profile: the connected Clio user's name and email (one who_am_i call, cached),
// and the firm name already used by the most recent firm profile. Never blocks sign-in on Clio.
import { get, getTokens } from "@/lib/server/clio/client";
import { firmNameFor } from "./index";

let cache: { at: number; name: string | null; email: string | null } | null = null;

async function who(): Promise<{ name: string | null; email: string | null } | null> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;
  const r = await Promise.race([
    get<{ data: { name?: string; email?: string } }>("users/who_am_i.json", { fields: "id,name,email" })
      .then((x) => ({ name: x.data?.name ?? null, email: x.data?.email ?? null }))
      .catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), 2500)),
  ]);
  if (r) cache = { at: Date.now(), ...r };
  return r ?? cache;
}

export async function firmDefaults(): Promise<{ display_name: string; email: string; firm_name: string }> {
  const [w, firm] = await Promise.all([who(), firmNameFor()]);
  return { display_name: w?.name ?? "", email: w?.email ?? "", firm_name: firm ?? "" };
}

/** Clio connection status for /profile: tokens on file and a live who_am_i answer. */
export async function clioConnection(): Promise<{ connected: boolean; name: string | null }> {
  try {
    await getTokens();
  } catch {
    return { connected: false, name: null };
  }
  const w = await who();
  return { connected: !!w, name: w?.name ?? null };
}
