// Mints a short-lived voice credential so the browser can talk to the voice provider directly.
// Long-lived keys never leave the server.
//   openai (default): an ephemeral Realtime client secret. The session's instructions and tools are
//     built here from the same access-checked context as /api/voice/context (provider mode only ever
//     carries the gated provider view).
//   deepgram (VOICE_PROVIDER=deepgram): a 60s Deepgram token for the Voice Agent socket.
// Missing or rejected key: 503 "voice not configured" and the UI shows a disabled state.
import { NextResponse, type NextRequest } from "next/server";
import { loadVoiceContext } from "@/lib/voice/server";
import { isDemoMode } from "@/lib/server/demo-mode";

export const dynamic = "force-dynamic";

const H = { "cache-control": "no-store" };
const off = () => NextResponse.json({ error: "voice not configured" }, { status: 503, headers: H });
const fail = (error: string, status = 502) => NextResponse.json({ error }, { status, headers: H });

const REALTIME_MODEL = process.env.VOICE_REALTIME_MODEL?.trim() || "gpt-realtime-mini";

function provider(): "openai" | "deepgram" {
  return process.env.VOICE_PROVIDER?.trim().toLowerCase() === "deepgram" ? "deepgram" : "openai";
}

async function deepgram() {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) return off();
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 60 }),
    cache: "no-store",
  });
  // A bad or revoked key comes back as 400 "Invalid credentials" (or 401/403).
  if ([400, 401, 403].includes(res.status)) return off();
  if (!res.ok) return fail("voice unavailable");
  const j = (await res.json()) as { access_token?: string };
  return j.access_token ? NextResponse.json({ provider: "deepgram", token: j.access_token }, { headers: H }) : fail("voice unavailable");
}

async function openai(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return off();
  const q = req.nextUrl.searchParams;
  // Probe only (page load): say whether voice is configured without minting anything.
  if (q.get("probe")) return NextResponse.json({ provider: "openai", ok: true }, { headers: H });
  const loaded = await loadVoiceContext(q);
  if (!loaded.ok) return fail(loaded.error, loaded.status);
  const c = loaded.ctx;
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: c.prompt,
        max_output_tokens: 1200,
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
            turn_detection: { type: "server_vad", silence_duration_ms: 600 },
          },
          output: { voice: "marin" },
        },
        tools: c.functions.map((f) => ({ type: "function", ...f })),
        tool_choice: "auto",
      },
    }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) return off();
  if (!res.ok) {
    console.warn("[voice] realtime client_secrets failed", res.status, (await res.text()).slice(0, 300));
    return fail("voice unavailable");
  }
  const j = (await res.json()) as { value?: string; expires_at?: number };
  if (!j.value) return fail("voice unavailable");
  return NextResponse.json({ provider: "openai", token: j.value, model: REALTIME_MODEL, matterId: loaded.matterId }, { headers: H });
}

export async function POST(req: NextRequest) {
  if (isDemoMode()) return NextResponse.json({ demo: true, error: "Voice is off in the public demo" }, { status: 503, headers: H });
  try {
    if (provider() === "deepgram") {
      if (req.nextUrl.searchParams.get("probe")) {
        if (!process.env.DEEPGRAM_API_KEY?.trim()) return off();
      }
      return await deepgram();
    }
    return await openai(req);
  } catch {
    return fail("voice unavailable");
  }
}
