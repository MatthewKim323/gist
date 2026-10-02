# Pipeline timeline: hand-off contract with the engine

Flow on `/matter`: landing -> seam-wipe -> **pipeline timeline** -> seam-wipe -> results dashboard.

## (a) Landing -> timeline (done, engine side)

Clicking "Open the case" (`/matter`) runs the `toMatter` transition: the home scene seam-wipes into the case
menu backdrop (night hall, arches, butterflies). Whatever `app/matter/page.tsx` renders inside
`<main data-router-view="matter">` sits on top of that backdrop. Keep that `<main>` as the route's only
root and don't give it a background; the backdrop is the background.

The timeline is the first thing rendered inside it.

## (b) Timeline -> dashboard (call `seamWipe`)

```tsx
"use client";
import { useState } from "react";
import { flushSync } from "react-dom";
import { seamWipe } from "@/lib/engine/seam";

const [phase, setPhase] = useState<"pipeline" | "digest">("pipeline");

{phase === "pipeline" ? (
  <PipelineTimeline
    runId={runId}
    onComplete={() => seamWipe(() => flushSync(() => setPhase("digest")))}
  />
) : (
  <Dashboard ... />
)}
```

`seamWipe(swap, opts?)` (`lib/engine/seam.ts`):

1. fades the matter `<main>` out and sweeps the backdrop shut to a flat color (the hall's own wipe shader),
2. runs `swap` while the screen is covered (change the DOM there; it waits two frames after for React),
3. sweeps the backdrop back open and fades the new content in. Resolves when done.

Options: `color` (default: the hall's fog color), `reveal: false` to hold on the flat color, `duration`
(seconds per half, default 1.6). Calls queue if one is already running. Without WebGL or before the engine
boots it just runs `swap`, so it is safe to call from a cached/instant run too.

So `PipelineTimeline` only needs to fire `onComplete()` once, after the run's last stage finishes
(and after any final "done" beat you want to show). Don't animate the whole timeline out yourself.

## Notes for content on /matter

- Text sits on a dark navy scene: use light ink.
- The backdrop listens to wheel/drag for its camera. For long content (dashboard), use your own scroll
  container (`position: fixed; inset: 0; overflow-y: auto`) so the page scrolls normally.
- Only client components can call `seamWipe` (call it from an event or effect, never during render).

---

# Component API (timeline session)

```tsx
import { PipelineTimeline } from "@/components/gist/pipeline";

<PipelineTimeline
  runId={runId}                 // from POST /api/pipeline {matterId} -> {runId}
  onComplete={() => seamWipe(() => flushSync(() => setPhase("digest")))}
  onFailed={(run) => { /* optional: run.status === "failed"; the timeline stays up showing what failed */ }}
/>
```

| prop | type | default | notes |
|---|---|---|---|
| `runId` | `string` | required | `agent_runs.id`. Changing it resets the view. |
| `onComplete` | `() => void` | required | Fired **once per runId**, after `agent_runs.status` becomes `done`, every stage node has revealed, and the "case digested" beat has held for `doneBeatMs`. Fire the seam-wipe from here. The timeline never animates itself out. |
| `onFailed` | `(run) => void` | none | Fired once if the run ends `failed`. No onComplete in that case. |
| `doneBeatMs` | `number` | `2600` | Hold on the "case digested" node before onComplete. |
| `source` | `PipelineSource` | Supabase | Swap the data source (the preview uses a simulated one). |
| `waves` | `boolean` | `true` | Moving line field behind the timeline. |

It renders `position: fixed; inset: 0; z-index: 50` (over the `#gl` canvas at z-40) with its own scroll
container, no background of its own, light ink. Put it directly inside `<main data-router-view="matter">`.
Styles: `app/styles/gist-pipeline.css` (imported by the component).

## Data (real mode)

- Browser Supabase client with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon can read
  `agent_runs` / `agent_tasks` only).
- Subscribes to Realtime `postgres_changes` on `agent_tasks` (`run_id=eq.<runId>`) and `agent_runs`
  (`id=eq.<runId>`) first, then loads the snapshot, merging by task id (a stale row never rolls a task
  backwards). Realtime bursts are batched per frame, so a cached rerun flipping every row at once is cheap.
- Reconcile poll: every 2s if Realtime is down, every 6s while it's live, stops once the run ends (plus one
  final snapshot on `done` so the receipt has every last row).
- No fake progress: tiles, counters and the receipt only show what the rows say. Denominators ("of 384")
  only appear when `agent_runs.stats` provides them.

## What each piece reads

- **Nodes**: one per role that has at least one row, in pipeline order (sync, ocr, extract, verify, jev,
  embed, reconcile, gate, synth), revealed one at a time as they appear. Title + one plain-English line per
  stage live in `stages.ts` (`STAGES`).
- **Tiles**: one per `agent_tasks` row: gray queued, pulsing running, green done (`+N` facts), blue cached
  (`$0`), red failed, dashed for the runner's `"<stage> (skipped)"` rows. Over 18 rows a stage switches to a
  dense swarm grid with a `now: ...` line of running shard labels. Hover a tile for tokens, cost, last_event.
- **Stage state**: working until nothing is queued/running and a later stage has started (or the run ended).
- **Counters** (`deriveCounters`): `agent_runs.stats` wins when present (`entries`, `pages`,
  `facts_verified`, `facts_rejected`, `jev_checks`, or `*_read` / `*_total`), otherwise they're summed from
  `last_event`. Facts emitted = extractor `facts_emitted` (or `"N facts unchanged"` on cached shards).
  Spent = sum of task `cost_usd` (run `cost_usd` once finished).

### last_event convention (content-free counts)

`"N key"` or `"N/M key"`, any separator, or `"key: N"` / `"key=N"`. The key is the first word after the number,
plurals normalize. Keys the UI reads: `entries` (sync), `pages` (ocr), `facts`, `rejected` (any stage),
`verified` (verify), `supported` (jev, `ok/N supported` counts N checks), `checks` (jev).
Examples: `"312 entries"`, `"10/10 pages"`, `"8 facts, 2 rejected"`, `"37/40 supported"`.

## Dev preview

`/pipeline-preview?runId=<uuid>` watches a real run. Without `runId` it replays a simulated run
(`mock.ts`, generic labels, labelled "simulated run · dev only" on screen) with cold / cached rerun / one
failure modes and 1x/2x/4x speed. Dev server: `bunx next dev -p 3812`.
