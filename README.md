# gist

**Where is this case, what moves it forward, and who owes what.** gist reads a personal-injury matter live from Clio Manage and turns it into two views:

- **For the firm:** a 90-second digest built around the case phase. It shows the current stage, a have / missing / conflicting checklist of what it takes to reach the next stage (each item with who owes it and for how long), case value against the coverage behind it, red flags where sources contradict each other, overdue and waiting-on items, the last real client contact, and injuries found in the scanned records. Every number, date and claim opens the exact note, email or PDF page it came from.
- **For the medical providers treating on a lien:** an attorney-curated, tokenized link. The provider sees whether the case is alive, a coverage tier, what the firm needs from their office (taken from the same checklist), their own records and bills status, and patient attendance. Strategy, valuation, other providers and anything privileged never leave the server. The attorney previews exactly what will be sent, Jev screens every outgoing line, each open is logged live, and the link can be revoked.

The "missing, owed by provider" rows on the firm's checklist and the provider's "what the firm needs from you" list are the same rows, so the gap and the ask live in one place.

## How it works

```
Clio (GET only) ─► sync ─► OCR ─► extractor swarm ─► verifier ─► Jev audit ─► index ─► reconcile ─► phase gates ─► story
                  hash    vision   ~70 parallel      quote must   supports /    hybrid   contradictions   have/missing   gpt-5.5 over
                  every   on image shards, cited      exist in     contradicts / search   across sources   + owner        verified facts
                  item    pages    facts             source       unsupported   (RRF)                                   only
```

Each step is tracked as a row in `agent_tasks`, and the loading timeline renders those rows live over Supabase Realtime. Nothing shown there is simulated.

- **Read-only on Clio.** The OAuth app has read scopes only, and the client in `lib/server/clio/client.ts` throws on any non-GET to the API. The only POST it ever sends is the OAuth token exchange.
- **Nothing hardcoded.** The matter, its stages, custom fields, providers and documents are discovered at runtime. The phase checklist is a generic NY personal-injury playbook (`lib/server/gates/playbook.ts`). Prompts are generic paralegal instructions.
- **Incremental and cached.** Every Clio item is hashed. Extraction is cached per shard by content hash + prompt version + model, gates are cached by their evidence, and the story is skipped when its input hasn't changed. Reopening an unchanged case costs $0. A new email costs cents.
- **Numbers come from code, not models.** Money, dates, days overdue, last client contact and firm spend are computed in `lib/server/signals`. Models rank, extract and narrate.
- **Citations are verified, not trusted.** A fact is kept only if its quote is found in the cited source (exact, or 0.85 token overlap for OCR noise) and its date and amount appear there. Jev then judges whether the source actually supports the claim. Anything below 0.8 goes to review instead of being shown as fact. Rejected facts are listed in the completeness receipt.
- **Omissions over hallucinations.** Every page is read, so nothing is sampled. Retrieval powers search and contradiction finding, not coverage.

## Submission answers

**Tech stack.**
- **Built with:** Next.js 16 (App Router, React 19), TypeScript, Three.js / WebGL for the landing and transitions, Supabase (Postgres + pgvector + Realtime + Storage), the OpenAI API, TypeSafe Jev, pdfjs and react-pdf.
- **Running on:** Vercel, or locally with `bun run dev`.
- **Data outside Clio:** Supabase Postgres holds derived data only: normalized source items, OCR'd page text, facts, embeddings, gates, digests, run logs, LLM cost logs, shares and view logs. Supabase Storage holds cached copies of the Clio documents. Clio stays the source of truth and is never written to.

**Models and cost per case.**
- `gpt-5.4-mini`: OCR of image-only pages, the extraction swarm, reconciliation, the gate checker.
- `gpt-5.5`: the 5-bullet story and "ask the case".
- `text-embedding-3-large` at 1536 dims: hybrid search.
- **Jev (TypeSafe AI)**: citation audit, contradiction confirmation, gate status confirmation, and the provider-share redaction gate.

Cost for one case (Sapini: 231 Clio items, 30 documents, 360 pages):
- First full digest: **about $0.70**. Extraction is about $0.45, the rest is reconcile, gates, embeddings, story and Jev.
- Reopening with no changes: **$0**.
- Updating after a new note or email: **a few cents**.

Every call is logged with tokens and cost in `llm_calls`, and the total shows on the dashboard.

**Where to look first.**
- `lib/server/pipeline/` covers the swarm, the verifier (`verify.ts`) and the Jev audit (`audit.ts`).
- `lib/server/gates/` holds the phase checklist.
- `lib/server/share/` builds the provider view and runs the redaction gate.
- `lib/server/clio/client.ts` is the read-only Clio client.

**Known gaps.**
- No attorney login. Share links are tokenized and revocable, but the firm side has no auth.
- The demo matter has no client photo in Clio, so the header shows initials. The face-crop path in `lib/server/docs/photo.ts` runs when an ID scan exists.
- Time in stage depends on Clio's stage timestamp, which the seeded demo matter set today.
- Per-token prices in `lib/server/llm.ts` are our best figures and may drift from OpenAI's current list price.

## Demo cases

The one real case (Sapini) comes live from Clio. So the cases list, radar, case switcher and assistant feel like a working firm, gist also carries three **synthetic** personal-injury matters, one per phase: Okafor (Treatment: rear-end soft tissue, a six week treatment gap, a client who stopped answering), Benbow (Demand: grocery slip-and-fall, wrist surgery, specials above the policy limit, a missing itemized bill) and Ferreyra (Negotiation: pedestrian vs rideshare, offer history, a Medicaid lien, a police report that contradicts the client's statement).

- **Fictional.** Every person, company and event in `demo/*.json` is invented. Dates are stored as offsets from the seed day, so overdue and upcoming math stays live.
- **Supabase only.** They are never in Clio and nothing is ever written to Clio. `matters.is_demo = true` (migration `0007_demo.sql`), ids sit in a reserved range (990000000001 and up), sync no-ops for them, autopilot skips them, and they carry no Clio links.
- **Labeled.** Display numbers start with `DEMO-`, `/cases` shows a Demo chip and lists them after real cases, and the dashboard header shows "Demo case" with no "Open in Clio".
- **Same pipeline, nothing faked.** `scripts/seed-demo.ts` writes the fixtures as Clio-shaped records through the same normalizers sync uses (`lib/server/sync/normalize.ts`), stores their text documents as `doc_pages`, then runs `runPipeline` minus sync and OCR: extraction, quote verification, the Jev audit, embeddings, reconcile, gates and the story. Every fact, gate, red flag and dollar figure on a demo dashboard came out of that run.

```bash
bun run job scripts/seed-demo.ts                 # seed (idempotent) and digest all three, about $0.25
bun run job scripts/seed-demo.ts --reset         # remove every demo row (only is_demo matters)
bun run job scripts/seed-demo.ts --reset --seed  # wipe and reseed
```

## Security & compliance

Case files are PHI-heavy (medical records, diagnoses, liens), so the data layer is locked down by default.

**Today (verified on the live project):**
- **Clio is read-only.** The OAuth app is scoped read-only and the code only issues GETs. gist never writes to the system of record.
- **Row Level Security on every table.** The browser only holds the public anon key; all case data is read and written server-side with the service role, which never leaves the server. Probing every table with the anon key returns 0 rows (and writes return 401). The only anon-readable tables are pipeline progress (`agent_runs`, `agent_tasks`: counts and shard labels, no case content) and share-link view pings (`share_views`), which the live UI needs over Realtime.
- **Hardening migration** (`supabase/migrations/0010_security_hardening.sql`): RLS forced on all tables, all table/sequence/function privileges revoked from client roles (except read-only on the three Realtime tables), default privileges revoked so new tables start locked, SQL functions (`hybrid_search`, `recall_memories`, ...) callable by the server only.
- **Private document storage.** Clio documents, derived photos and provider uploads live in a private bucket; nothing is publicly addressable.
- **Provider sharing is least-privilege.** Providers see only what the attorney toggles on, filtered server-side, behind a hashed, expiring, revocable token with a view log. Provider comms are treated as non-privileged ("deposition-safe by default").
- **Minimal data to third-party models.** Model calls send the excerpts a stage needs, not the whole file, and every call is logged with tokens and cost.
- **Secrets stay out of the repo** (`.env*` is git-ignored; the anon key is the only key shipped to the client).

**Roadmap to HIPAA and SOC 2** (not certified today, this is the plan):
- **HIPAA:** signed BAAs with every subprocessor that touches PHI (database/storage host, model providers, hosting), encryption at rest and in transit end to end (already TLS + provider-managed at-rest), field-level encryption for the most sensitive columns, immutable audit logs of every PHI read (who, what, when), minimum-necessary access by role, breach-notification runbook, and a zero-retention agreement with model providers.
- **SOC 2 Type II:** SSO + MFA for firm users, role-based access with quarterly access reviews, centralized logging and alerting, change management (PR review, CI checks, migrations reviewed), vendor risk reviews, documented incident response and backup/restore drills, then an audit window with a third-party auditor.
- **Firm controls:** per-firm data isolation (tenant id on every row, enforced in RLS), configurable retention and deletion, export on request, and a customer-facing trust page.

## Run it

```bash
bun install
cp .env.example .env.local     # fill in Clio, Supabase, OpenAI, TypeSafe
supabase db query --linked -f supabase/migrations/0001_init.sql
bun run job scripts/sync.ts     # discover + sync the first open PI matter
bun run job scripts/pipeline.ts # full run: OCR, swarm, verify, index, reconcile, gates, story
bun run dev                     # http://127.0.0.1:3777/matter
```

Clio OAuth: create a developer app with read-only scopes and set the redirect to `http://127.0.0.1:3000/api/clio/callback` (Clio rejects `localhost`), or seed `CLIO_ACCESS_TOKEN` / `CLIO_REFRESH_TOKEN`.

## Use it from Claude (MCP)

gist ships a read-only MCP server so a lawyer can brief, search and cite a case from Claude Desktop or Claude Code: `list_cases`, `get_digest`, `get_phase_checklist`, `get_contradictions`, `search_case`, `get_fact`, `get_source`, `ask_case`. Nothing it does writes to the case or calls Clio.

```bash
claude mcp add gist -- bun run --cwd /absolute/path/to/gist mcp
```

Claude Desktop config, the bearer-token HTTP endpoint (`/api/mcp`) and the tool reference are in [docs/MCP.md](docs/MCP.md).
