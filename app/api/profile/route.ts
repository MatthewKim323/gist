// The signed-in user's own profile. GET reads it, PATCH edits name, email, title and firm name.
// Role and office are fixed at creation (they decide what this session may see) and cannot be patched.
import { NextResponse, type NextRequest } from "next/server";
import { getSession, setSession } from "@/lib/server/auth/session";
import { findOffice } from "@/lib/server/auth/offices";
import { getProfile, parseFields, updateProfile } from "@/lib/server/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function mine() {
  const s = await getSession();
  if (!s) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) } as const;
  const p = await getProfile(s.profileId);
  if (!p) return { error: NextResponse.json({ error: "No profile for this session. Sign in again." }, { status: 404 }) } as const;
  return { s, p } as const;
}

export async function GET() {
  const m = await mine();
  if ("error" in m) return m.error;
  const office = m.p.role === "provider" ? await findOffice(Number(m.p.provider_contact_id)).catch(() => null) : null;
  return NextResponse.json({ profile: m.p, office: office ? { contact_id: office.contact_id, name: office.name, cases: office.cases.length } : null });
}

export async function PATCH(req: NextRequest) {
  const m = await mine();
  if ("error" in m) return m.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseFields(body, { requireName: false });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch = { ...parsed.patch };
  if (m.p.role !== "firm") delete patch.firm_name; // a provider's firm name is never theirs to set
  if (!Object.keys(patch).length) return NextResponse.json({ profile: m.p });
  try {
    const p = await updateProfile(m.p.id, patch);
    if (!p) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    // Keep the cookie's display name in step with the profile.
    if (p.display_name !== m.s.name) {
      const { iat: _iat, ...rest } = m.s; // eslint-disable-line @typescript-eslint/no-unused-vars
      await setSession({ ...rest, name: p.display_name });
    }
    return NextResponse.json({ profile: p });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
