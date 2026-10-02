# QA: routes, links, buttons

Crawled with headless Chromium against a local dev server as three personas: no session, firm, provider (signed in through `POST /api/auth/session` with a profile). Every page was loaded, console errors and 4xx/5xx responses were collected, every same-origin `href` was requested, and every visible button was clicked and checked for an effect (navigation, network call, or DOM change). Paid or writing calls were stubbed in the browser (pipeline, sync, autopilot tick, actions propose/patch, share create/revoke, submissions writes, ask, voice token, Clio OAuth).

Headless Chromium has no WebGL, so the landing engine (menu toggle, sound, case menu scene) cannot boot there. Those controls were checked by reading the markup, not by clicking.

## Pass 1 (13:25 to 14:30)

| Route / control | Persona | Result | Fix / owner |
|---|---|---|---|
| All pages: `/`, `/signin`, `/contact`, `/cases`, `/provider`, `/profile`, `/s/compose`, `/pipeline-preview`, `/matter?view=digest`, `/matter?fixture=1` | none, firm | 200 | ok |
| `/provider`, `/profile` | none | 307 to `/signin?next=...` | ok |
| `/cases`, `/matter*`, `/s/compose`, `/pipeline-preview` | provider | 307 to `/provider` | ok |
| every firm API | provider | 403 JSON | ok |
| `/s/<bad token>` | all | 200, "Link not found" page, no crash | ok |
| API GETs with missing or bad params (`/api/actions`, `/api/share`, `/api/submissions`, `/api/similar`, `/api/matter/<bad>/digest`, `/api/matter/<id>/source/<bad>`, `/api/voice/context`, `/api/profile` signed out) | none, firm | 400/401/404 JSON, no 500s | ok |
| `/api/docs/<bad>`, `/api/docs/photo/<bad>` | firm | 404 plain text (file routes) | ok, not JSON but never 500 |
| POST-only routes on GET (`/api/ask`, `/api/share/preview`, `/api/autopilot/tick`, `/api/actions/propose`, `/api/voice/token`) | all | 405 | ok |
| `/api/clio/callback` with no or bad code | firm | 307 to `/cases?clio_error=...`, banner shows the error | ok |
| 404 page "View our work" button | all | linked to `/projects`, which does not exist | FIXED: now "Open your cases" to `/cases` (`app/not-found.tsx`) |
| `/signin?next=/profile` | none | sign-in ignored `next`, always landed on `/cases` or `/provider` | FIXED: `components/gist/auth/SignInChoices.tsx` honors a local `next` that fits the chosen role |
| Radar "Client silent" and "Treatment gap" rows | firm | linked to `#story` / `#providers`, which are not dashboard tabs, so the dashboard opened on Overview by accident / wrong tab | FIXED: `lib/server/radar/index.ts` now uses `#overview` and `#treatment` |
| Profile chip menu: Profile, Your cases, Switch account, Sign out; `/profile` Sign out | firm, provider | all navigate correctly, sign out clears the session | ok |
| `/s/compose` composer: every section toggle, money mode, fact pick, Publish | none/firm | each fires a preview or publish request | ok (Resize preview is a drag handle, pointer-only, not dead) |
| `/pipeline-preview` controls | none | all change the timeline | ok |
| `/cases` Autopilot toggle, Check Clio now, Show all, Sync & digest, Refresh from Clio, Reconnect Clio | none/firm | network calls / OAuth redirect | ok |
| Shell world button `href="/about"` | all | `/about` was a 404 | FIXED by the landing owner in 46243a1 |
| Menu "02 Matter" and hidden nav "Matter" (`components/Shell.tsx:81`, `:116`) and landing "Open the case" (`components/PersistentContent.tsx:85`) | all | go to plain `/matter`, which POSTs `/api/pipeline` on the first matter (a cached $0 rerun when nothing changed, but a real run when Clio changed) | OWNER Shell/landing, by design per MatterView. Optional: point the menu item at `/cases` |

## Pass 1b (14:15 to 14:45): dashboard tabs, new routes

| Route / control | Persona | Result | Fix / owner |
|---|---|---|---|
| `/matter?view=digest&id=<sapini>#overview`, `#phase`, `#money`, `#flags`, `#actions`, `#drafts`, `#treatment`, `#injuries`, `#inbox`, `#shares`, `#receipt` | firm | 200, every sidebar tab switches and updates the hash, no failed requests, no console errors | ok |
| Every citation chip on every tab | firm | opens the source drawer (doc or page fetch), no 404s | ok |
| Sidebar: case switcher, All cases, Share with provider, Open in Clio | firm | switcher navigates, share sheet opens and loads providers | ok |
| Drafts: Approve & copy, Open in email, Dismiss, Also send share link, Redraft, Draft ready chip on gate rows | firm | PATCH/propose (stubbed), chip opens `#drafts` | ok |
| Ask the case (Cmd+K), Ask gist OS dock, Brief me (voice), dock close | firm | palette and dock open, POSTs stubbed | ok |
| Demo cases `id=990000000001..3` (the real demo ids; `-1001..-1003` do not exist) | firm | 200, all tabs and APIs 200 | ok |
| `/s/<live token>` (one test share, then revoked) | none | provider card renders; Call the firm's case line, Respond, Bill, Send (validates), Cancel all work; after revoke shows "Link revoked" | ok |
| Landing `/contact` scene sign-in (`SceneSignIn`) | none | Law firm / Medical provider tabs, firm row signs in and goes to `/matter` (pipeline stubbed), provider row goes to `/provider`, "Create a profile" to `/signin` | ok |
| `/whitepaper`, `/evals`, `/api/auth/choices` | all | 200, all links resolve | ok |
| `/api/mcp` GET | none, firm | 406 (Streamable HTTP wants POST + SSE accept), provider 403 | ok |
| `/api/assistant` GET with no body | none, firm | 400 JSON | ok |
| `/matter?view=digest&id=<unknown or bad>` | firm | shows "Digest unavailable 404 on /api/matter/12345/digest" with no way out: no link back, sidebar not rendered (dead end) | OWNER dashboard: `components/gist/dashboard/Dashboard.tsx:232-235`, inside `gd-errorbox` after `<p>{load.message}</p>` add `<p><a href="/cases" onClick={(e) => { e.preventDefault(); window.location.assign("/cases"); }}>Back to all cases</a></p>` |
