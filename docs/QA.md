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
| Shell world button `href="/about"` (`components/Shell.tsx:364`) | all | `/about` is a 404. The button is `d-none` and nothing in the engine un-hides it, so it is not reachable today | OWNER Shell/engine: change `href="/about"` to `href="/contact"` or delete the anchor |
| Menu "02 Matter" and hidden nav "Matter" (`components/Shell.tsx:81`, `:116`) and landing "Open the case" (`components/PersistentContent.tsx:85`) | all | go to plain `/matter`, which POSTs `/api/pipeline` on the first matter (a cached $0 rerun when nothing changed, but a real run when Clio changed) | OWNER Shell/landing, by design per MatterView. Optional: point the menu item at `/cases` |
