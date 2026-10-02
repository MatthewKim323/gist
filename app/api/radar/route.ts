// Firm-wide radar: what needs a lawyer's attention across every digested case. Deterministic, no model calls.
// Firm-only (proxy.ts answers 403 to provider sessions).
import { NextResponse } from "next/server";
import { radar } from "@/lib/server/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await radar());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
