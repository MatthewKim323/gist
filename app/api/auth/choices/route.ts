// What the in-scene sign-in (landing contact scene) needs: recent profiles per side, the provider offices
// that can sign in, and the firm prefill from the connected Clio user. Same data /signin renders server-side.
import { NextResponse } from "next/server";
import { listOffices } from "@/lib/server/auth/offices";
import { recentProfiles } from "@/lib/server/profiles";
import { firmDefaults } from "@/lib/server/profiles/firm-defaults";

export const dynamic = "force-dynamic";

export async function GET() {
  const [offices, firm, provider, prefill] = await Promise.all([
    listOffices().catch(() => []),
    recentProfiles("firm", { limit: 3 }).catch(() => []),
    recentProfiles("provider", { limit: 3 }).catch(() => []),
    firmDefaults().catch(() => ({ display_name: "", email: "", firm_name: "" })),
  ]);
  const lite = (p: (typeof firm)[number]) => ({ id: p.id, display_name: p.display_name, firm_name: p.firm_name, title: p.title });
  return NextResponse.json({
    firm: firm.map(lite),
    provider: provider.map(lite),
    offices: offices.slice(0, 4).map((o) => ({ contact_id: o.contact_id, name: o.name })),
    prefill,
  });
}
