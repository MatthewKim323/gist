import "server-only";
// Public demo mode: Ask gist OS without a model. Runs the same read-only tools in code, then streams a
// short templated answer whose cites come from the tool outputs (so the cite chips and drawer still work).
import { DEMO_AI_LINE } from "../demo-mode";
import { TOOL_BY_NAME, runTool, type ToolCtx } from "./tools";
import type { AssistantEvent } from "./agent";
import type { Citation } from "@/lib/types";

type Emit = (e: AssistantEvent) => void;

const INTENTS: { re: RegExp; tool: string; title: string }[] = [
  { re: /\b(money|value|worth|coverage|limit|policy|lien|special|bill|cost|spend|settle|demand)\w*/i, tool: "get_money", title: "Here is the money picture from the file:" },
  { re: /\b(red ?flag|contradict|conflict|inconsisten|disagree)\w*/i, tool: "get_red_flags", title: "Here are the contradictions in the file:" },
  { re: /\b(treat|provider|doctor|injur|visit|medical|gap|therap|chiro|clinic)\w*/i, tool: "get_treatment", title: "Here is treatment and providers from the file:" },
  { re: /\b(gate|phase|checklist|missing|requirement|stage)\w*/i, tool: "get_phase_checklist", title: "Here is the phase checklist:" },
  { re: /\b(overview|summar|story|about|who is|catch me up|brief)\w*/i, tool: "get_overview", title: "Here is the case snapshot:" },
];
const NEXT = /\b(next|todo|to do|should|priorit|move|focus|today|urgent|action|follow ?up|what now)\b/i;

function register(ctx: ToolCtx, cites: Citation[] | null | undefined): string {
  const out: string[] = [];
  for (const c of (cites ?? []).slice(0, 3)) {
    if (!c?.source_ref) continue;
    if (!ctx.refs.has(c.source_ref)) ctx.refs.set(c.source_ref, { label: c.label, quote: c.quote });
    out.push(c.source_ref);
  }
  return out.length ? ` [${out.join(", ")}]` : "";
}

/** Tool text is written for a model: keep the bullet lines, drop blanks, cap the length. */
function trimTool(s: string, max = 14): string {
  const lines = s.split("\n").filter((l) => l.trim());
  return lines.slice(0, max).join("\n") + (lines.length > max ? `\n(${lines.length - max} more lines in the file)` : "");
}

async function movesAnswer(ctx: ToolCtx, emit: Emit): Promise<string> {
  emit({ type: "tool", name: "get_next_moves", label: TOOL_BY_NAME.get("get_next_moves")?.activity({}) ?? "ranked the next moves" });
  await runTool(ctx, "get_next_moves", {}); // sets ctx.moves (the dock renders them as action cards) and ctx.digest
  const d = ctx.digest;
  const open = (ctx.moves ?? []).slice(0, 3);
  const gates = d?.phase.gates ?? [];
  const L = [d ? `${d.matter.client_name} is in ${d.phase.current}${d.phase.next ? `, working toward ${d.phase.next}` : ""} with ${gates.filter((g) => g.status === "have").length} of ${gates.length} gate items in hand.` : "Here is where the case stands.", ""];
  if (open.length) {
    L.push("Next moves:");
    open.forEach((m, i) => L.push(`${i + 1}. **${m.title}**. ${m.why}${m.unblocks ? ` (${m.unblocks})` : ""}${register(ctx, m.cites)}`));
  } else L.push("Nothing is blocking this case right now.");
  const flags = d?.red_flags ?? [];
  if (flags.length) L.push("", `Watch: ${flags[0].title}${register(ctx, flags[0].claims.map((c) => ({ source_ref: c.source_ref, label: c.label, quote: c.quote })))}`);
  return L.join("\n");
}

async function searchAnswer(ctx: ToolCtx, q: string, emit: Emit): Promise<string | null> {
  emit({ type: "tool", name: "search_case", label: TOOL_BY_NAME.get("search_case")!.activity({ q }) });
  const out = await runTool(ctx, "search_case", { q });
  const blocks = out.split("\n\n").filter((b) => /^\[[^\]]+\]/.test(b)).slice(0, 3);
  if (!blocks.length) return null;
  const L = ["Closest matches in the file (keyword search):"];
  for (const b of blocks) {
    const [head, ...body] = b.split("\n");
    const m = head.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!m) continue;
    const snip = body.join(" ").replace(/\s+/g, " ").trim().slice(0, 220);
    const title = m[2].replace(/^\[[^\]]*\]\s*/, "").trim();
    L.push(`- ${title ? `${title}: ` : ""}${snip}${snip.length >= 220 ? "..." : ""} [${m[1]}]`);
  }
  return L.join("\n");
}

/** Returns the answer text (cites inline in brackets, registered on ctx.refs). Emits tool + delta events. */
export async function demoAnswer(ctx: ToolCtx, message: string, emit: Emit): Promise<string> {
  let body: string | null = null;
  const intent = INTENTS.find((i) => i.re.test(message));
  if (intent && !NEXT.test(message)) {
    emit({ type: "tool", name: intent.tool, label: TOOL_BY_NAME.get(intent.tool)!.activity({}) });
    body = `${intent.title}\n\n${trimTool(await runTool(ctx, intent.tool, {}))}`;
  } else if (!NEXT.test(message) && (message.match(/\S+/g) ?? []).length >= 2) {
    body = await searchAnswer(ctx, message, emit).catch(() => null);
  }
  if (!body) body = await movesAnswer(ctx, emit);
  const text = `${body}\n\n_${DEMO_AI_LINE}_`;
  // stream in a few chunks so the dock renders like a live answer
  for (const chunk of text.match(/[\s\S]{1,120}/g) ?? []) {
    emit({ type: "delta", text: chunk });
    await new Promise((r) => setTimeout(r, 25));
  }
  return text;
}
