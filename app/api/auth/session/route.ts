// Demo-grade sign-in (no passwords, see lib/server/auth/token.ts). Signing in picks or creates a profile
// (table `profiles`); the role, office and profile id are signed into an httpOnly cookie and enforced
// server-side by proxy.ts and requireRole().
import { NextResponse, type NextRequest } from "next/server";
import { clearSession, getSession, setSession } from "@/lib/server/auth/session";
import { findOffice } from "@/lib/server/auth/offices";
import { createProfile, getProfile, isProfileId, parseFields, touchProfile, type Profile } from "@/lib/server/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nextFor = (p: Profile) => (p.role === "provider" ? "/provider" : "/cases");

async function signInAs(p: Profile) {
  await setSession({
    role: p.role,
    name: p.display_name,
    profileId: p.id,
    ...(p.role === "provider" ? { providerContactId: Number(p.provider_contact_id) } : {}),
  });
  await touchProfile(p.id).catch(() => null);
  return NextResponse.json({ ok: true, next: nextFor(p), profile: p });
}

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ session: null, profile: null });
  const profile = await getProfile(s.profileId).catch(() => null);
  return NextResponse.json({
    session: { role: s.role, name: profile?.display_name ?? s.name, providerContactId: s.providerContactId ?? null, profileId: s.profileId ?? null },
    profile,
  });
}

/**
 * POST {profileId}                                         continue as an existing profile
 * POST {role:"firm", display_name, email?, title?, firm_name?}            new firm profile
 * POST {role:"provider", providerContactId, display_name, email?, title?} new provider profile
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.profileId !== undefined) {
      if (!isProfileId(body.profileId)) return NextResponse.json({ error: "Unknown profile" }, { status: 400 });
      const p = await getProfile(body.profileId);
      if (!p) return NextResponse.json({ error: "That profile no longer exists" }, { status: 404 });
      if (p.role === "provider" && !(await findOffice(Number(p.provider_contact_id))))
        return NextResponse.json({ error: "That office is not on any case right now" }, { status: 404 });
      return await signInAs(p);
    }
    if (body.role !== "firm" && body.role !== "provider")
      return NextResponse.json({ error: "role must be firm or provider" }, { status: 400 });
    const parsed = parseFields(body, { requireName: true });
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (body.role === "firm") {
      const p = await createProfile({ role: "firm", display_name: parsed.patch.display_name!, ...parsed.patch });
      return await signInAs(p);
    }
    const id = Number(body.providerContactId);
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "Pick your office" }, { status: 400 });
    // Only offices that actually appear as a treating provider on a synced case can sign in.
    const office = await findOffice(id);
    if (!office) return NextResponse.json({ error: "That office is not on any case" }, { status: 404 });
    const p = await createProfile({
      role: "provider",
      display_name: parsed.patch.display_name!,
      email: parsed.patch.email ?? null,
      title: parsed.patch.title ?? null,
      firm_name: null,
      provider_contact_id: id,
    });
    return await signInAs(p);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true, next: "/signin" });
}
