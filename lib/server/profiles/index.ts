import "server-only";
// Profiles (table `profiles`, migration 0005). Demo-grade identity: no passwords, a profile is picked or
// created on /signin and its id rides in the signed gist_session cookie. Service-role only (RLS on).
import { db } from "@/lib/server/db";
import type { Role } from "@/lib/server/auth/token";

export interface Profile {
  id: string;
  role: Role;
  display_name: string;
  email: string | null;
  title: string | null;
  firm_name: string | null;
  provider_contact_id: number | null;
  avatar_color: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface ProfileInput {
  display_name?: unknown;
  email?: unknown;
  title?: unknown;
  firm_name?: unknown;
}

const COLORS = ["#8db8ff", "#8fe0b0", "#efded9", "#f5c97a", "#c3a6ff", "#7fd6e0", "#ff9f8a"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isProfileId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

function clean(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
}

/** Validates editable fields. Returns the patch or an error message. */
export function parseFields(input: ProfileInput, { requireName }: { requireName: boolean }) {
  const out: Partial<Pick<Profile, "display_name" | "email" | "title" | "firm_name">> = {};
  if ("display_name" in input || requireName) {
    const n = clean(input.display_name, 80);
    if (!n) return { error: "Name is required" } as const;
    out.display_name = n;
  }
  if ("email" in input) {
    const e = clean(input.email, 160);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: "That email does not look right" } as const;
    out.email = e;
  }
  if ("title" in input) out.title = clean(input.title, 60);
  if ("firm_name" in input) out.firm_name = clean(input.firm_name, 120);
  return { patch: out } as const;
}

export async function getProfile(id: string | null | undefined): Promise<Profile | null> {
  if (!isProfileId(id)) return null;
  const { data } = await db().from("profiles").select("*").eq("id", id).maybeSingle();
  return (data as Profile | null) ?? null;
}

/** Recent profiles for the "Continue as" list. Provider list can be narrowed to one office. */
export async function recentProfiles(role: Role, opts: { providerContactId?: number; limit?: number } = {}): Promise<Profile[]> {
  let q = db().from("profiles").select("*").eq("role", role).order("last_seen_at", { ascending: false }).limit(opts.limit ?? 8);
  if (opts.providerContactId) q = q.eq("provider_contact_id", opts.providerContactId);
  const { data } = await q;
  return (data ?? []) as Profile[];
}

export async function createProfile(p: {
  role: Role;
  display_name: string;
  email?: string | null;
  title?: string | null;
  firm_name?: string | null;
  provider_contact_id?: number | null;
}): Promise<Profile> {
  const avatar_color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
  const { data, error } = await db()
    .from("profiles")
    .insert({ ...p, avatar_color, provider_contact_id: p.role === "provider" ? p.provider_contact_id : null })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not create profile: ${error?.message ?? "no row"}`);
  return data as Profile;
}

export async function updateProfile(id: string, patch: Partial<Profile>): Promise<Profile | null> {
  const { data, error } = await db().from("profiles").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Profile | null) ?? null;
}

export async function touchProfile(id: string) {
  await db().from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

/**
 * The firm name a provider should see. Prefers the profile that created the share, then the most
 * recently active firm profile with a firm name, then GIST_FIRM_NAME, then the given fallback.
 */
export async function firmNameFor(opts: { createdBy?: string | null; fallback?: string | null } = {}): Promise<string | null> {
  try {
    const own = await getProfile(opts.createdBy);
    if (own?.firm_name) return own.firm_name;
    const { data } = await db()
      .from("profiles")
      .select("firm_name")
      .eq("role", "firm")
      .not("firm_name", "is", null)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const recent = (data as { firm_name: string | null } | null)?.firm_name;
    if (recent) return recent;
  } catch {}
  return process.env.GIST_FIRM_NAME ?? opts.fallback ?? null;
}
