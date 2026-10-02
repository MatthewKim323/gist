# Swans x Law-Di-Gras hackathon: research brief (2026-10-02)

Hard close 4:00 PM PT. Submission order = presentation order. Top 7 picked "in the code" (Swans reads the repo), top 3 picked on stage (4 min pitch).

## 1. What actually wins

**Screening (Swans, top 7):** live Clio reads, zero writes, zero hardcoding (never write the string "Sapini" in code), incremental/cached digestion, real cost per case, clean engineering. Swans CTO Martin Kravchenko is a Clio Certified Partner + KPI/pipeline nerd. His line: "omissions pose greater danger than hallucinations."

**Stage (judges):**
| Judge | Who | What lands |
|---|---|---|
| Erika Contreras | Partner, Panish Shea Ravipudi (elite catastrophic PI) | case value, coverage, injuries, every fact sourced |
| Mark Day | Coastal Research (policy-limits searches) | coverage panel: known / unknown / not researched |
| Eleonor Harutyunyan | KAASS Law (high-volume CA PI, multilingual) | speed to get staff up to speed |
| Colleen Joyce | CEO Lawyer.com | polish, storytelling, client empathy |
| Jared Podnos | VP Partnerships TR, ex-Harvey (multiplayer/permissions) | layer on Clio, multi-party, distribution story |
| Andy Roddick | ViewFi co-founder (virtual ortho/PT) | THE PROVIDER VOICE: is my patient showing up, will I get paid |
| Jerry Zhou | CEO Supio | Supio already does cited medchron/demands, no provider features. Don't claim medchron depth |

**Table stakes (shrug):** text summary of matter (Clio Manage AI already does this), chat box, medchron.
**Novel:** two-sided view from one source of truth, attorney-curated provider share with redaction + open tracking, per-user "since you last looked" diff, provably cheap incremental digest, completeness meter ("312/312 entries read, 4 scans OCR'd, 0 skipped").

## 2. The Sapini matter (what's actually in it)

- Justin Sapini, MVA 2023-04-23, sideswiped by a **Metro-North utility vehicle**, New Rochelle **NY**. Both shoulders, both knees, head injury.
- Stage: **Litigation**, stuck in discovery. SOL 2026-04-22 (suit filed, so not blown). Treating 3+ years, no MMI, second shoulder surgery recommended with no date.
- **NEW YORK case, not CA.** NY is a no-fault state: Progressive no-fault $50k exhausted (Ins Law 5104(a), not recoverable from tortfeasor), serious-injury threshold, CPLR 4545 collateral source pleaded. Don't show CA law on this matter.
- **Underwater case:** est. value $375k (specials $118,400 + wage loss $214k) vs defendant limit $100k/$300k (Metro-North self-insured, Claims Service Bureau, scope-of-employment issue). UM/UIM $25k/$50k. Medicaid lien $22,180. SSDI pending.
- Red flags baked in: liability "contested on two levels, neither investigated", prior injuries "denied by client, contradicted by his own paperwork", three different accident accounts in notes, prior ankle injury.
- Volume: 42 notes, 69 comms (56 email, 13 phone), 14 tasks (6 pending, one SOL), 17 calendar entries, expenses, ~15-31 docs (live account has more than the Drive JSON; trust live), 15 contacts, 16 custom fields.
- **No contact avatars.** Client face is in `01-intake__created__photo-id.pdf` (image-only scan of NY driver license). Extract the image from the doc at runtime = derived, not hardcoded.
- **Scans needing OCR:** two medical bundles (~42MB, ~34MB, the "200-page scan" with injuries), summons/complaint, letter to judge, photo ID. Subpoena has junk OCR text layer.
- No bills / PI add-on data (medical_records_details, damages likely empty). Derive bills/liens from docs, notes, custom fields.
- Provider asks live in tasks named like "By medical provider: McCulloch ... Updated records".
- Providers: Montefiore Nyack, McCulloch Ortho, Dr. David Capiola, Advanced Rockland Chiro, SportsCare PT. Classify via relationship `description` text.

Seed payloads: `research/sapini-clio-data.json`. Clio OpenAPI: `research/clio-openapi.json`.

## 3. Clio API cheat sheet

- Own OAuth app at developers.clio.com, **read-only scopes on everything** (a judge-friendly proof of the no-write rule). Trial may or may not allow app creation; ask Swans if blocked.
- `https://app.clio.com/oauth/token`, access 30 days, refresh never expires. Store refresh token.
- No `fields=` returns only id/etag. Nesting one level deep only. `limit=200`, `order=id(asc)`, follow `meta.paging.next`. `updated_since` on all lists.
- Rate limit: docs say 50/min peak (all day today); Swans JSON says 600/min. Build a backoff wrapper either way.
- Notes need `type=Matter`. Expenses: `/activities.json?type=ExpenseEntry`. Docs download: `/documents/ID/download.json` -> 303 presigned URL (no auth header on the second fetch).
- Skip webhooks (POST to Clio = grey area). Poll `updated_since`.
- No SDK worth using. Raw fetch + ~60 line wrapper. `npx openapi-typescript research/clio-openapi.json -o clio.d.ts` for types.

## 4. Architecture (recommended)

Next.js App Router + Tailwind/shadcn, Supabase Postgres + Storage, Vercel deploy (share link must open on a phone in the demo).

Pipeline:
1. **Sync**: per resource, `updated_since` cursor, normalize -> `source_items` with sha256 content_hash; tombstone missing ids.
2. **OCR**: text layer first (free); image pages -> Claude Haiku 4.5 transcription in 10-20 page slices, cached per (doc version, page). Tag pages (`medical_record|bill|police_report...`, `has_diagnosis`).
3. **Extract**: Haiku 4.5, batched, structured output; every fact = {kind, summary, event_date, amount, source_ref, quote, importance, audience}. Cache key = content_hash + prompt_version + model.
4. **Verify**: drop facts whose source_ref wasn't in the prompt; quote must fuzzy-match source text (>=0.85) and contain the date. Unverified = hidden.
5. **Synthesize**: Opus 5.5 (effort low/medium) over facts only, skipped if fact set unchanged. Numbers (spend, last contact, overdue) computed in code, never by the LLM.
6. **Log** every LLM call with tokens + cost; show it in the UI.

Cost: ~$2 cold per case, $0 warm open, ~$0.05 per incremental update. Gotchas: Opus/Sonnet 5.5 reject forced tool_choice and thinking disabled; use structured outputs + effort.

## 5. Product: what to build

**Firm view (90 seconds):**
- Header: client photo, name, DOI, days since, stage bar (8 stages), responsible attorney.
- Hero KPIs: case value vs coverage behind it, with **"underwater" flag** (value $375k vs $100k cap), firm spend to date, Medicaid lien. Settlement waterfall: limit - fee - costs - liens = client net.
- Deadline strip, overdue / upcoming / waiting-on-whom (firm / provider / carrier / client).
- Last real client contact (days, red if >30).
- Injuries card from the scans with page citations.
- Treatment timeline per provider with gaps shaded.
- "Top 10 of 300" ranked feed + expand-all. "Since you last opened" rail.
- **Contradictions / risk card**: 3 accident accounts, prior injury denial vs paperwork. Strong omission-defense moment.
- Completeness meter.
- Every number/date clickable -> source drawer (note/email text with highlighted quote, or PDF at the page).

**Provider view (the differentiator):**
- Attorney share composer: section toggles (defaults: share status, coverage tier, their bills/records status, what firm needs from them, attendance signal; hide strategy, value, offers, other lienholders, notes). Per-fact overrides. Side-by-side live preview. Server-side filtering only.
- Tokenized link (store hash), expiry, revoke, view log ("opened 3x, last 2:41pm").
- Provider sees: coarse stage tracker, "case alive" heartbeat, coverage tier (not exact limits by default), their balance + records/bills received checkmarks, action items for their office, "patient attended X of Y", stage-change notifications.
- Pitch line: "deposition-safe by default". Provider comms aren't privileged, assume defense sees it.

## 6. Build order (cut lines)

1. 9:30-10:15 seeder running, scaffold, schema, Clio OAuth. Commit.
2. -11:15 sync engine all resources + doc download. Kick OCR of big bundles in background.
3. -12:15 extraction + quote verification + cost logging.
4. -1:30 firm dashboard + source drawer + KPIs.
5. -2:15 since-last-opened, completeness, cost badge.
6. -3:15 provider share composer + link + view tracking.
7. -3:45 deploy, README (stack, data location, models, cost, known gaps), 90s clip, SUBMIT EARLY.

Cut first: Citations API narrative, OTP gate, email notifications (show log), multilingual. Never cut: source links, quote verification, incremental cache, cost logging, provider view.

## 7. Pitch (4 min)

Open: "Dr. McCulloch's office calls: is this case even alive?" -> firm digest in 90s, click a date to its source page -> flip to provider view, redact, share, show it opened -> close on "$X per case, $0 to reopen, reads Clio, writes nothing."

## 8. Frontier bar (round 2 research)

Everyone frontier (Supio, CoCounsel, Harvey, Eve, Legora) ships: page-level citations, an agent that shows its plan + human approval, an auditor sweep, a self-updating case file. NOBODY ships: a provider-facing side, "what we did NOT read", or per-case cost.

Top demo moments (wow per build hour):
1. Hover any number -> quote card; click -> source drawer, PDF at page with highlight (react-pdf customTextRenderer; scans = page image + OCR transcript side by side).
2. Contradictions card: 3 accident accounts in 3 cited columns + prior-injury denial vs paperwork. Supio's "present vs missing" view doesn't do this.
3. Underwater bar ($375k value vs $100k hard line) + settlement waterfall, all numbers computed + cited.
4. Share composer: toggles left, live provider preview right, "Redacted by firm" placeholders visible.
5. Live "opened" ping: QR -> phone opens link -> toast on attorney screen (Supabase Realtime). Revoke live.
6. Completeness receipt incl. "7 facts rejected by verifier" with reasons.
7. Provider treatment Gantt (CSS grid), gaps shaded + cited, ghost diamond for unscheduled 2nd shoulder surgery.
8. Since-you-last-looked rail, GitHub-style diff.
9. Cost badge: "$1.84 to digest · $0.00 to reopen".
10. Real pipeline run log stepper (no fake animation).

Avoid: chat-first UI (cmd-K only), "medchron"/"demand" claims, "agentic/AGI/AI paralegal", fake confidence decimals (use verified + corroboration count), CA law on a NY case, fake progress, writing to Clio. Say "drafted for attorney review", "deposition-safe by default", "reads Clio, writes nothing".

## 9. Jev (TypeSafe AI) as the auditor layer

Jev = TypeSafe AI "System One" model (launched 2026-09-15, early access). Typed questions over a state -> calibrated answers, never generates text. `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, npm `@typesafe-ai/sdk`. $0.042/M input, output free, 70-500ms. 64k tokens/request. Weak at math/counting/date compare (keep in code).

Use as a narrow verification layer: "Opus writes, Jev audits."
1. Citation verifier: code checks the quote verbatim, then a Jev `choice` (supports / contradicts / says nothing) per claim; < 0.8 confidence -> "needs attorney eyes" tray. Show "212 claims checked, 3 to review, $0.0004".
2. Provider share redaction gate: `noul` per outgoing snippet ("contains settlement figure / strategy / prior-injury discussion") -> auto-redact or flag before the link goes out.
3. Contradiction detector over paired accounts.
4. Cheap relevance triage before Haiku.
Risks: early-access key (check console.typesafe.ai first; fall back to a Haiku enum verifier), PHI to a 2-week-old API (send minimal excerpts, note in README), not load-bearing.

## 10. Decisions locked (10:05)
- Swarm/OCR/extraction model: OpenAI `gpt-5.4-mini` (vision-capable, one vendor with embeddings). Embeddings `text-embedding-3-large` @ 1536.
- Jev verified working. Request shape: `{"model":"jev-latest","state":"...","questions":{"key":{"type":"noul","instructions":"..."}}}` -> `{"answers":{"key":{"type":"noul","noul":0.97}}}`. choice adds `"criteria":{"label":"desc"}`.
- Keys live in /Users/matthewkim/dev/ldg/.env.local (copy into the gist repo's .env.local; repo is PUBLIC, never commit).
- Clio dev app: read-only scopes.
- Clio OAuth done 10:17. Tokens in .env.local (access 30d, refresh never expires). Rate limit confirmed 50/min.
- Live Sapini (never hardcode the id; discover via /matters.json): 42 notes, 69 comms, 14 tasks, 17 calendar, 30 documents, 14 activities (ExpenseEntry filter), 14 relationships. Stage Litigation.
