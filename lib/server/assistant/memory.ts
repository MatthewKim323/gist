import "server-only";
// Relationship memory: small durable notes about the person using gist (what they focus on, how they
// like answers, who they track), embedded and recalled into every turn. Same shape as jabby/gbrain:
// write few, write short, recall hybrid (vector + keyword), dedupe on write.
import { z } from "zod";
import { db } from "../db";
import { embed, structured } from "../llm";
import { env } from "../env";

export type MemoryKind = "preference" | "focus" | "fact" | "relationship";
export interface Memory { id: string; kind: MemoryKind; text: string; matter_id: number | null; importance: number; score?: number }

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
function jaccard(a: string, b: string) {
  const A = words(a), B = words(b);
  let i = 0;
  for (const w of A) if (B.has(w)) i++;
  const u = A.size + B.size - i;
  return u ? i / u : 0;
}

export async function recallMemories(profileId: string, q: string, matterId: number | null, k = 5, qEmb?: string): Promise<Memory[]> {
  const emb = qEmb ?? (q.trim() ? (await embed([q.slice(0, 2000)], { purpose: "assistant.recall", matterId }))[0] : null);
  const res = await db().rpc("recall_memories", { p_profile: profileId, q_emb: emb, k, p_matter: matterId, q_text: q.slice(0, 300) || null });
  if (res.error) throw new Error(`recall_memories: ${res.error.message}`);
  const out = (res.data ?? []) as Memory[];
  if (out.length) void db().from("profile_memories").update({ last_used_at: new Date().toISOString() }).in("id", out.map((m) => m.id)).then(() => {});
  return out;
}

export async function recentMemories(profileId: string, limit = 4): Promise<Memory[]> {
  const res = await db().from("profile_memories").select("id,kind,text,matter_id,importance").eq("profile_id", profileId)
    .order("created_at", { ascending: false }).limit(limit);
  return (res.data ?? []) as Memory[];
}

export async function saveMemory(profileId: string, m: { kind: MemoryKind; text: string; importance?: number; matterId?: number | null }, existing: Memory[] = []): Promise<boolean> {
  const text = m.text.replace(/\s*[—–]\s*/g, ", ").trim().slice(0, 300);
  if (!text) return false;
  const pool = existing.length ? existing : await recentMemories(profileId, 30);
  const dup = pool.find((e) => jaccard(e.text, text) > 0.55);
  if (dup) {
    await db().from("profile_memories").update({ last_used_at: new Date().toISOString(), importance: Math.min(5, (dup.importance ?? 3) + 1) }).eq("id", dup.id);
    return false;
  }
  const [vec] = await embed([text], { purpose: "assistant.memory", matterId: m.matterId ?? null });
  const ins = await db().from("profile_memories").insert({
    profile_id: profileId, matter_id: m.matterId ?? null, kind: m.kind, text, embedding: vec, importance: m.importance ?? 3,
  });
  if (ins.error) throw new Error(`profile_memories: ${ins.error.message}`);
  return true;
}

const Extract = z.object({
  memories: z.array(z.object({
    kind: z.enum(["preference", "focus", "fact", "relationship"]),
    text: z.string(),
    importance: z.number().int(),
    case_specific: z.boolean(),
  })),
});

/** After a turn: 0-2 durable things worth knowing about this user next time. Returns what was saved. */
export async function extractMemories(profileId: string, matterId: number, caseLabel: string, userMsg: string, answer: string, known: Memory[]): Promise<string[]> {
  const { data } = await structured({
    model: env.swarmModel(),
    reasoning: "low",
    system:
      "You maintain a small memory about a lawyer or case manager who uses a case assistant. From the latest exchange, extract 0 to 2 DURABLE notes " +
      "about the USER (not the case facts): what they are focused on or prioritizing, how they like answers, people or providers they keep tracking, " +
      "their role or habits. Write each as a short third-person line, e.g. 'Prioritizes getting SportsCare records before the demand' or " +
      "'Prefers bullet answers with deadlines first'. Skip anything already known, anything generic ('asked a question'), and one-off curiosity. " +
      "Most turns yield nothing: return an empty list unless it would clearly help next time. importance 1-5. case_specific true if it only matters for this case.",
    input: `Case: ${caseLabel}\nAlready known:\n${known.map((m) => `- ${m.text}`).join("\n") || "(nothing)"}\n\nUser: ${userMsg.slice(0, 1500)}\n\nAssistant answer (abridged): ${answer.slice(0, 1200)}`,
    schema: Extract,
    schemaName: "user_memories",
    meta: { purpose: "assistant.extract", matterId },
  });
  const saved: string[] = [];
  for (const m of data.memories.slice(0, 2)) {
    if (m.text.length < 8) continue;
    const ok = await saveMemory(profileId, { kind: m.kind, text: m.text, importance: Math.max(1, Math.min(5, m.importance)), matterId: m.case_specific ? matterId : null }, known);
    if (ok) { saved.push(m.text); known.push({ id: "", kind: m.kind, text: m.text, matter_id: null, importance: m.importance }); }
  }
  return saved;
}
