// Mints a short-lived Deepgram token so the browser can open the Voice Agent socket directly.
// The long-lived key never leaves the server. Missing or rejected key: 503 and the UI disables voice.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const off = () => NextResponse.json({ error: "voice not configured" }, { status: 503, headers: { "cache-control": "no-store" } });

export async function POST() {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) return off();
  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return off();
    if (!res.ok) return NextResponse.json({ error: "voice unavailable" }, { status: 502 });
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return NextResponse.json({ error: "voice unavailable" }, { status: 502 });
    return NextResponse.json({ token: j.access_token, expires_in: j.expires_in ?? 60 }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "voice unavailable" }, { status: 502 });
  }
}

export const GET = POST;
