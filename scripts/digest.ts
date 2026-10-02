// Build (or preview) the digest for every matter. bun run job scripts/digest.ts [--build] [--gates] [out.json]
import { writeFileSync } from "node:fs";
import { db } from "@/lib/server/db";
import { getDigest, rebuildDigest } from "@/lib/server/digest";
import { checkGates } from "@/lib/server/gates";
import { startRun, finishRun } from "@/lib/server/pipeline/ctx";

async function main() {
  const args = process.argv.slice(2);
  const out = args.find((a) => a.endsWith(".json"));
  const { data: ms } = await db().from("matters").select("id");
  for (const m of ms ?? []) {
    const id = Number(m.id);
    if (args.includes("--gates")) {
      const ctx = await startRun(id);
      try { const g = await checkGates(ctx); console.error(`gates: ${g.length}`); await finishRun(ctx, "done", { gates: g.length }); }
      catch (e) { await finishRun(ctx, "failed"); throw e; }
    }
    const r = args.includes("--build") ? await rebuildDigest(id) : await getDigest(id, null);
    const json = JSON.stringify(r, null, 2);
    if (out) writeFileSync(out, json); else console.log(json);
    console.error(`matter ${id}: version ${r.version}, story ${r.digest.story.length}, gates ${r.digest.phase.gates.length}, flags ${r.digest.red_flags.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
