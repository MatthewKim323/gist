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
