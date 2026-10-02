// Browser side of the voice agent, ported from hyper's voice stack. The browser talks to the voice
// provider directly with a short-lived credential minted by /api/voice/token:
//   openai (default): Realtime over WebRTC, mic track up, agent audio down, events on "oai-events".
//   deepgram: the Voice Agent socket (flux listen, Deepgram-managed gpt-4o-mini think, aura-2 speak).
// Function calls are answered here from the code-built context, so no model ever computes a number.
"use client";

import type { Citation } from "@/lib/types";
import type { VoiceContext } from "./brief";

export type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "researching" | "speaking" | "error" | "off";
export interface Caption {
  id: number;
  role: "user" | "assistant";
  text: string;
}
export interface VoiceCallbacks {
  onState: (s: VoiceState, detail?: string) => void;
  onCaption: (c: Caption) => void;
  /** firm mode: open a source in the dashboard drawer; false if no drawer is mounted */
  onOpenSource?: (cite: Citation) => boolean;
}

const ENDPOINT = "wss://agent.deepgram.com/v1/agent/converse";
const IN_RATE = 16000;
const OUT_RATE = 24000;

// Area-averaging resampler to 16k linear16, 80ms frames. Same algorithm as hyper's onboarding worklet,
// inlined as a Blob module so it needs no file in public/.
const WORKLET = `
class R{constructor(i,o,f){this.ratio=i/o;this.rem=this.ratio;this.sum=0;this.f=f;this.buf=new ArrayBuffer(f*2);this.v=new DataView(this.buf);this.p=0}
push(ch){const out=[];if(!ch.length||!ch[0])return out;for(let i=0;i<ch[0].length;i++){let s=0;for(const c of ch)s+=Number.isFinite(c[i])?c[i]:0;s=Math.max(-1,Math.min(1,s/ch.length));let a=1;
while(a>1e-9){const w=Math.min(a,this.rem);this.sum+=s*w;this.rem-=w;a-=w;if(this.rem<1e-9){const x=Math.max(-1,Math.min(1,this.sum/this.ratio));this.v.setInt16(this.p++*2,Math.round(x*(x<0?32768:32767)),true);this.rem=this.ratio;this.sum=0;
if(this.p===this.f){out.push(this.buf);this.buf=new ArrayBuffer(this.f*2);this.v=new DataView(this.buf);this.p=0}}}}return out}}
class P extends AudioWorkletProcessor{constructor(){super();this.r=new R(sampleRate,${IN_RATE},1280)}process(inputs){for(const f of this.r.push(inputs[0]||[]))this.port.postMessage(f,[f]);return true}}
registerProcessor('gist-voice-pcm',P);
`;

/** Captions never show long dashes. */
const clean = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, ", ").trim();

export class VoiceSession {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private clock = 0;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private captionId = 0;
  private closed = false;
  private state: VoiceState = "idle";
  /** analyser over agent playback, for the orb glow */
  analyser: AnalyserNode | null = null;

  constructor(
    private query: string,
    private cb: VoiceCallbacks,
  ) {}

  private set(s: VoiceState, detail?: string) {
    this.state = s;
    this.cb.onState(s, detail);
  }

  async start() {
    this.set("connecting");
    try {
      // Mic permission inside the click gesture, alongside the AudioContext.
      this.ctx = new AudioContext();
      const [tokRes, ctxRes, mic] = await Promise.all([
        fetch(`/api/voice/token?${this.query}`, { method: "POST" }),
        fetch(`/api/voice/context?${this.query}`),
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      ]);
      this.mic = mic;
      if (tokRes.status === 503) {
        const b = (await tokRes.json().catch(() => ({}))) as { demo?: boolean };
        return this.fail(b.demo ? "Voice is off in the public demo." : "Voice is not configured on this server.", "off");
      }
      if (!tokRes.ok) {
        const e = (await tokRes.json().catch(() => ({}))) as { error?: string };
        return this.fail(tokRes.status === 502 ? "Voice service is unavailable right now." : (e.error ?? "Voice could not start."));
      }
      if (!ctxRes.ok) {
        const e = (await ctxRes.json().catch(() => ({}))) as { error?: string };
        return this.fail(e.error ?? "Case context is unavailable.");
      }
      const tok = (await tokRes.json()) as { provider: "openai" | "deepgram"; token: string; model?: string; matterId?: number };
      const context = (await ctxRes.json()) as VoiceContext;
      if (this.closed) return this.stop();
      if (tok.provider === "openai") await this.openRealtime(tok.token, context, tok.model ?? "realtime", tok.matterId);
      else this.open(tok.token, context);
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone permission was denied." : "Voice could not start.";
      this.fail(msg);
    }
  }

  private open(token: string, context: VoiceContext) {
    const ws = new WebSocket(ENDPOINT, ["bearer", token]);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "Settings",
          mip_opt_out: true,
          audio: {
            input: { encoding: "linear16", sample_rate: IN_RATE },
            output: { encoding: "linear16", sample_rate: OUT_RATE, container: "none" },
          },
          agent: {
            listen: { provider: { type: "deepgram", model: "flux-general-en", version: "v2" } },
            // Deepgram-managed model: billed by Deepgram, no OpenAI key involved.
            think: { provider: { type: "open_ai", model: "gpt-4o-mini" }, prompt: context.prompt, functions: context.functions },
            speak: { provider: { type: "deepgram", model: "aura-2-thalia-en" } },
            greeting: context.greeting,
          },
        }),
      );
      this.keepalive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
      }, 8000);
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) return this.play(ev.data);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.handle(msg, context);
    };
    ws.onerror = () => this.fail("Voice connection failed.");
    ws.onclose = () => {
      if (!this.closed && this.state !== "error" && this.state !== "off") this.stop();
    };
  }

  private async startMic() {
    const ctx = this.ctx!;
    if (ctx.state === "suspended") await ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    if (this.closed || !this.mic) return;
    this.src = ctx.createMediaStreamSource(this.mic);
    this.node = new AudioWorkletNode(ctx, "gist-voice-pcm");
    this.node.port.onmessage = (e) => {
      const ws = this.ws;
      if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 64000 && e.data instanceof ArrayBuffer) ws.send(e.data);
    };
    this.src.connect(this.node);
    // Silent sink keeps the worklet pulled; outputs are zeros.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(ctx.destination);
  }

  private handle(msg: Record<string, unknown>, context: VoiceContext) {
    switch (msg.type) {
      case "SettingsApplied":
        this.startMic()
          .then(() => this.set("listening"))
          .catch(() => this.fail("Microphone streaming is unavailable in this browser."));
        break;
      case "UserStartedSpeaking":
        this.flush();
        this.set("listening");
        break;
      case "AgentThinking":
        this.set("thinking");
        break;
      case "AgentStartedSpeaking":
        this.set("speaking");
        break;
      case "AgentAudioDone": {
        // Playback may still be queued; settle to listening when it drains.
        const wait = Math.max(0, (this.clock - (this.ctx?.currentTime ?? 0)) * 1000);
        setTimeout(() => {
          if (this.state === "speaking") this.set("listening");
        }, wait);
        break;
      }
      case "ConversationText": {
        const role = msg.role === "user" ? "user" : "assistant";
        const text = String(msg.content ?? "").trim();
        if (text) this.cb.onCaption({ id: ++this.captionId, role, text: clean(text) });
        if (role === "user") this.set("thinking");
        break;
      }
      case "FunctionCallRequest": {
        const fns = (msg.functions ?? []) as { id: string; name: string; arguments?: string; client_side?: boolean }[];
        for (const f of fns) {
          if (f.client_side === false) continue;
          this.set("researching", f.name);
          const content = this.answer(f.name, f.arguments ?? "{}", context);
          this.ws?.send(JSON.stringify({ type: "FunctionCallResponse", id: f.id, name: f.name, content: JSON.stringify(content) }));
        }
        break;
      }
      case "Error":
        this.fail(typeof msg.description === "string" ? `Voice error: ${msg.description}` : "The voice agent reported an error.");
        break;
    }
  }


  // ---------------- OpenAI Realtime over WebRTC (default provider) ----------------
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 };
  private usageMeta: { model: string; matterId?: number; started: number } | null = null;
  private partial = "";

  private async openRealtime(secret: string, context: VoiceContext, model: string, matterId?: number) {
    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.usageMeta = { model, matterId, started: Date.now() };
    const el = document.createElement("audio");
    el.autoplay = true;
    this.audioEl = el;
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      el.srcObject = stream;
      // Tap the remote stream for the orb glow (not routed to speakers; the audio element plays it).
      const ctx = this.ctx;
      if (ctx && stream) {
        void ctx.resume();
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(this.analyser);
      }
    };
    for (const t of this.mic!.getAudioTracks()) pc.addTrack(t, this.mic!);
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onopen = () => {
      this.set("listening");
      // The agent speaks first: the brief (firm) or a greeting (provider).
      this.rt({ type: "response.create", response: { instructions: context.opener } });
    };
    dc.onmessage = (ev) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.handleRealtime(m, context);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.fail("Voice connection dropped.");
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/sdp" },
    });
    if (!res.ok) return this.fail("Voice service is unavailable right now.");
    if (this.closed) return;
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  }

  private rt(event: unknown) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  private handleRealtime(m: Record<string, unknown>, context: VoiceContext) {
    switch (m.type) {
      case "input_audio_buffer.speech_started":
        this.set("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        this.set("thinking");
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(m.transcript ?? "").trim();
        if (text) this.cb.onCaption({ id: ++this.captionId, role: "user", text: clean(text) });
        break;
      }
      case "response.output_audio_transcript.delta":
        this.partial += String(m.delta ?? "");
        if (this.state !== "speaking") this.set("speaking");
        break;
      case "response.output_audio_transcript.done": {
        const text = String(m.transcript ?? this.partial).trim();
        this.partial = "";
        if (text) this.cb.onCaption({ id: ++this.captionId, role: "assistant", text: clean(text) });
        break;
      }
      case "output_audio_buffer.started":
        this.set("speaking");
        break;
      case "output_audio_buffer.stopped":
        if (this.state === "speaking") this.set("listening");
        break;
      case "response.function_call_arguments.done": {
        const name = String(m.name ?? "");
        this.set("researching", name);
        const content = this.answer(name, String(m.arguments ?? "{}"), context);
        this.rt({ type: "conversation.item.create", item: { type: "function_call_output", call_id: m.call_id, output: JSON.stringify(content) } });
        this.rt({ type: "response.create" });
        break;
      }
      case "response.done": {
        const u = ((m.response as Record<string, unknown> | undefined)?.usage ?? null) as {
          input_tokens?: number;
          output_tokens?: number;
          input_token_details?: { cached_tokens?: number };
        } | null;
        if (u) {
          this.usage.input_tokens += u.input_tokens ?? 0;
          this.usage.output_tokens += u.output_tokens ?? 0;
          this.usage.cached_tokens += u.input_token_details?.cached_tokens ?? 0;
        }
        break;
      }
      case "error": {
        const e = m.error as { message?: string } | undefined;
        console.warn("[voice] realtime error", e?.message);
        break;
      }
    }
  }

  /** Answer a function call from the code-built context. Never calls a model. */
  private answer(name: string, args: string, context: VoiceContext): unknown {
    if (name === "open_source") {
      let key = "";
      try {
        key = String((JSON.parse(args || "{}") as { source?: string }).source ?? "");
      } catch {}
      const cite = context.sources?.[key];
      const opened = !!cite && !!this.cb.onOpenSource?.(cite);
      return opened ? { opened: true } : { opened: false, reason: "That source is not available to open here." };
    }
    if (name in context.answers) return context.answers[name];
    return { error: "Unknown function. Only the listed functions exist." };
  }

  private flushUsage() {
    const meta = this.usageMeta;
    this.usageMeta = null;
    if (!meta || (!this.usage.input_tokens && !this.usage.output_tokens)) return;
    const body = JSON.stringify({ ...this.usage, model: meta.model, matterId: meta.matterId, duration_ms: Date.now() - meta.started });
    try {
      if (!navigator.sendBeacon?.("/api/voice/usage", new Blob([body], { type: "application/json" })))
        void fetch("/api/voice/usage", { method: "POST", body, keepalive: true });
    } catch {}
  }

  private play(buf: ArrayBuffer) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed" || this.closed) return;
    const view = new DataView(buf);
    const n = Math.floor(buf.byteLength / 2);
    if (!n) return;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    const audio = ctx.createBuffer(1, n, OUT_RATE);
    audio.copyToChannel(samples, 0);
    const s = ctx.createBufferSource();
    s.buffer = audio;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(ctx.destination);
    }
    s.connect(this.analyser);
    const at = Math.max(ctx.currentTime, this.clock);
    this.clock = at + audio.duration;
    this.sources.add(s);
    s.onended = () => {
      this.sources.delete(s);
      s.disconnect();
    };
    s.start(at);
    if (this.state !== "speaking") this.set("speaking");
  }

  /** Barge-in: drop queued agent audio. */
  private flush() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {}
      s.disconnect();
    }
    this.sources.clear();
    this.clock = 0;
  }

  private fail(message: string, state: VoiceState = "error") {
    this.teardown();
    this.set(state, message);
  }

  private teardown() {
    this.closed = true;
    this.flushUsage();
    try {
      this.dc?.close();
      this.pc?.getSenders().forEach((x) => x.track?.stop());
      this.pc?.close();
    } catch {}
    this.dc = null;
    this.pc = null;
    if (this.audioEl) this.audioEl.srcObject = null;
    this.audioEl = null;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    this.flush();
    try {
      this.node?.port.close();
      this.node?.disconnect();
      this.src?.disconnect();
    } catch {}
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close();
    this.ws = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }

  stop() {
    this.teardown();
    this.set("idle");
  }
}
