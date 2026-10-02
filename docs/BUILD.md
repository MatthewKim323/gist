# gist build plan (parallel agents)

Product: see `docs/research/FEATURE_MAP.md`. Contracts: `lib/types.ts`, schema `supabase/migrations/0001_init.sql` (already applied).

## Pipeline order (`lib/server/pipeline/run.ts` calls these in sequence)

| # | stage | module export | owner | writes |
|---|---|---|---|---|
| 1 | sync | `syncMatter(ctx)` in `lib/server/sync/index.ts` | sync | matters, matter_stages, source_items, documents (+ storage `docs/<matter>/<doc>-<version>.pdf`), sync_state |
| 2 | ocr | `ocrMatter(ctx)` in `lib/server/docs/index.ts` | docs | doc_pages, documents.ocr_status, matters.photo_path |
| 3 | extract + verify + jev | `extractMatter(ctx)` in `lib/server/pipeline/extract.ts` | swarm | facts, extraction_cache |
| 4 | index | `indexMatter(ctx)` in `lib/server/retrieval/index.ts` | retrieval | chunks (+ embeddings) |
| 5 | reconcile | `reconcileMatter(ctx)` in `lib/server/reconcile/index.ts` | retrieval | contradictions, merged facts |
| 6 | gates | `checkGates(ctx)` in `lib/server/gates/index.ts` | digest | gate_items |
| 7 | synth | `buildDigest(ctx)` in `lib/server/digest/index.ts` | digest | digests |

Every stage wraps work in `ctx.task(role, label, fn)` (`lib/server/pipeline/ctx.ts`). That is what the pipeline timeline renders live.

## Ownership (only touch your paths; shared files are read-only unless noted)

- **sync**: `lib/server/clio/**`, `lib/server/sync/**`, `app/api/clio/**`, `app/api/sync/**`, `scripts/sync.ts`
- **docs**: `lib/server/docs/**`, `scripts/ocr.ts`, `app/api/docs/**` (file + page image serving for the source drawer)
- **swarm**: `lib/server/pipeline/**` (except ctx.ts additions are OK), `app/api/pipeline/**`, `scripts/pipeline.ts`
- **retrieval**: `lib/server/retrieval/**`, `lib/server/reconcile/**`, `app/api/ask/**`, `app/api/similar/**`
- **digest**: `lib/server/signals/**`, `lib/server/gates/**`, `lib/server/digest/**`, `app/api/matter/**`
- **dashboard UI**: `components/gist/dashboard/**`, `components/gist/source/**`, `app/matter/**` content inside the existing route shell, `app/styles/gist-dashboard.css`
- **timeline UI**: `components/gist/pipeline/**`, `app/styles/gist-pipeline.css`
- **share**: `lib/server/share/**`, `app/api/share/**`, `app/s/**`, `components/gist/share/**`, `app/styles/gist-share.css`
- **engine / landing / seam-wipe transitions**: the other session (ldg-47). Don't edit `lib/engine/**`, `components/Shell.tsx`, `app/layout.tsx`, `app/page.tsx`.

## Rules

- Clio is read-only. GET only. Never hardcode the matter id, client name, or any case fact; discover via `/matters.json`. Judges read the repo.
- New York case. No California law.
- Numbers (money, dates, overdue, last contact, spend) are computed in code, never by a model.
- Every fact on screen carries a `SourceRef`.
- Models: `env.swarmModel()` (gpt-5.4-mini) for workers/OCR, `env.synthModel()` (gpt-5.5) for the story, `text-embedding-3-large` @1536, Jev for verification + redaction. All calls go through `lib/server/llm.ts` / `lib/server/jev.ts` so cost is logged.
- Scripts: `bun run job scripts/<x>.ts` (loads .env.local, react-server condition for `server-only`).
- Long commands (sync, OCR, pipeline runs, builds) run in the background. Typecheck with `bunx tsc --noEmit`.
- Commit small and often: `git add <your paths>`, `git pull --rebase origin main`, `git push origin HEAD:main`. No AI attribution in commits. No em dashes anywhere.
