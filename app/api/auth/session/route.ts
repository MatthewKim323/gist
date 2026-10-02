// Demo-grade role sign-in (no passwords, see lib/server/auth/token.ts). The role is signed into an
// httpOnly cookie and enforced server-side by proxy.ts and requireRole().
import { NextResponse, type NextRequest } from "next/server";
import { clearSession, getSession, setSession } from "@/lib/server/auth/session";
import { findOffice } from "@/lib/server/auth/offices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  return NextResponse.json({ session: s ? { role: s.role, name: s.name, providerContactId: s.providerContactId ?? null } : null });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { role?: string; providerContactId?: unknown };
  if (body.role === "firm") {
    await setSession({ role: "firm", name: "Firm staff" });
    return NextResponse.json({ ok: true, next: "/matter?view=digest" });
  }
  if (body.role === "provider") {
    const id = Number(body.providerContactId);
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "Pick your office" }, { status: 400 });
    // Only offices that actually appear as a treating provider on a synced case can sign in.
    const office = await findOffice(id);
    if (!office) return NextResponse.json({ error: "That office is not on any case" }, { status: 404 });
    await setSession({ role: "provider", providerContactId: id, name: office.name });
    return NextResponse.json({ ok: true, next: "/provider" });
  }
  return NextResponse.json({ error: "role must be firm or provider" }, { status: 400 });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
