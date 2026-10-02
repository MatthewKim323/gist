import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { listProviders } from "@/lib/server/share";

export const dynamic = "force-dynamic";

/** GET /api/share/providers?matterId=  ->  treating providers on the matter. Without matterId: the matters list (ids + display numbers). */
export async function GET(req: NextRequest) {
  const matterId = Number(req.nextUrl.searchParams.get("matterId"));
  try {
    if (!matterId) {
      const { data } = await db().from("matters").select("id,display_number,stage").order("id");
      return NextResponse.json({ matters: data ?? [] });
    }
    return NextResponse.json({ providers: await listProviders(matterId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
