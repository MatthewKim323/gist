# Retrieval + swarm design

## Verdicts
- Non-scan case text is ~20k tokens: stuff it in context, no RAG.
- Retrieval earns its keep on OCR'd scan pages (~150-250k tokens) and the fact table (dedup, contradiction clustering, find-similar, "ask the case").
- Injury hunt is NOT retrieval (top-K = omissions). Exhaustive per-page extraction by the swarm; retrieval is the evidence browser on top. Stage line: "we read every page, we don't sample."
- Provider redaction is an `audience` column + server-side WHERE, not an embeddings feature.
- Skip: HNSW tuning, rerankers, GraphRAG at 3k rows.

## Embeddings
text-embedding-3-large, `dimensions: 1536`, stored `halfvec(1536)`. Whole case about $0.04. Exact scan at this size (HNSW optional).
Chunking: 1 note/email/task = 1 chunk with header `[email 2023-05-07 from client -> firm | "subject"]`; 1 scan page = 1 chunk, cite `doc:ID#pPAGE`; facts = `fact:UUID`.

## Ported from gbrain (~/dev/gbrain/src/core/search/{hybrid,expansion,dedup}.ts)
RRF k=60 across keyword + N vector lists, multi-query expansion (>=3 words, max original+2, clinical synonyms), 1.5x boost for verified facts over raw chunks, dedup: max 2 per source, Jaccard > 0.85 drop, no kind > 60%.

## Schema + hybrid search
```sql
create extension if not exists vector;
create extension if not exists pg_trgm;

create table chunks (
  id bigserial primary key,
  matter_id text not null,
  source_kind text not null,            -- note|email|call|task|calendar|doc_page|fact
  source_id text not null,
  page int,
  part int not null default 0,
  cite text generated always as (
    source_kind || ':' || source_id || coalesce('#p' || page, '')) stored,
  event_date date,
  audience text not null default 'firm', -- firm | provider_ok
  header text not null default '',
  body text not null,
  content_hash text not null,
  embedding halfvec(1536),
  fts tsvector generated always as (
    setweight(to_tsvector('english', header), 'A') ||
    setweight(to_tsvector('english', body), 'B')) stored,
  unique (matter_id, source_kind, source_id, page, part)
);
create index on chunks using gin (fts);
create index on chunks using gin (body gin_trgm_ops);
create index on chunks (matter_id, source_kind);

create or replace function or_tsquery(q text) returns tsquery language sql immutable as $$
  select nullif(replace(plainto_tsquery('english', q)::text, '&', '|'), '')::tsquery
$$;

create or replace function hybrid_search(
  p_matter text, q_text text, q_embs text[],
  match_count int default 20,
  kinds text[] default null,
  audiences text[] default array['firm','provider_ok'],
  rrf_k int default 60, fact_boost float default 1.5
) returns table (id bigint, cite text, source_kind text, header text, body text,
                 event_date date, score float)
language sql stable as $$
with base as (
  select * from chunks
  where matter_id = p_matter and audience = any(audiences)
    and (kinds is null or source_kind = any(kinds))
),
kw as (
  select id, row_number() over (order by ts_rank_cd(fts, or_tsquery(q_text)) desc) r
  from base where fts @@ or_tsquery(q_text)
  order by r limit match_count * 3
),
vec as (
  select id, r from (
    select b.id,
           row_number() over (partition by e.i order by b.embedding <=> e.v::halfvec(1536)) r
    from unnest(q_embs) with ordinality e(v, i)
    cross join base b
    where b.embedding is not null
  ) x where r <= match_count * 3
),
fused as (
  select id, sum(w) s from (
    select id, 1.0 / (rrf_k + r) w from kw
    union all
    select id, 1.0 / (rrf_k + r) from vec
  ) u group by id
)
select c.id, c.cite, c.source_kind, c.header, c.body, c.event_date,
       (f.s / max(f.s) over ()) * case when c.source_kind = 'fact' then fact_boost else 1 end as score
from fused f join chunks c using (id)
order by score desc
limit match_count * 2;
$$;

create or replace function similar_chunks(p_id bigint, k int default 6)
returns table (id bigint, cite text, body text, sim float) language sql stable as $$
  select c.id, c.cite, c.body, 1 - (c.embedding <=> s.embedding)
  from chunks c, chunks s
  where s.id = p_id and c.id <> p_id and c.matter_id = s.matter_id and c.embedding is not null
  order by c.embedding <=> s.embedding limit k
$$;
```

## Swarm
Shards (~60): notes x10 per shard, comms x15, tasks+calendar+expenses+custom fields 1 shard, small docs 1 each, scan bundles 10-page slices. Cache key = sha256(shard) + prompt_version + model.

Phases: sync -> OCR (text layer first, image pages -> Haiku vision, cached per doc_version+page) -> EXTRACTORS (N parallel Haiku, structured output, facts carry `event_key` like `accident.mechanism`, `prior_injury.ankle`) -> VERIFIER (deterministic: cite in shard, quote fuzzy >= 0.85, dates/amounts in quote) -> CRITIC (LLM only for borderline 0.70-0.85 or importance >= 4) -> embed facts -> RECONCILER (group by event_key + cosine >= 0.80 within 30 days; one LLM call per multi-source cluster -> contradictions) -> SYNTHESIZER (Opus 5.5, skipped if fact-set hash unchanged).

```sql
create table agent_runs (id uuid primary key default gen_random_uuid(), matter_id text,
  status text default 'running', started_at timestamptz default now(), cost_usd numeric default 0);
create table agent_tasks (
  id bigserial primary key, run_id uuid references agent_runs, role text,
  shard_label text, input_ref jsonb, cache_key text,
  status text default 'queued',  -- queued|running|done|cached|failed
  attempts int default 0, worker text, started_at timestamptz, finished_at timestamptz,
  tokens_in int default 0, tokens_out int default 0, cost_usd numeric default 0,
  facts_emitted int default 0, last_event text);
alter publication supabase_realtime add table agent_tasks;

-- claim
update agent_tasks set status='running', worker=$1, started_at=now(), attempts=attempts+1
where id = (select id from agent_tasks where run_id=$2 and role=$3 and status='queued'
            order by id for update skip locked limit 1)
returning *;
```

Run: `POST /api/index` creates the run and spawns 8 workers via `waitUntil`, with a resume param if the function times out. Run the big-scan OCR locally from `scripts/index.ts` using the same module, kicked off early, so the cache makes Vercel runs instant.

Demo theater: swarm grid of task tiles on Realtime (queued/running/done/cached $0/failed), live fact ticker with rejected quotes struck through, contradiction cards animating in, footer "312/312 entries · 384/384 pages · 0 skipped · $X cold · $0 reopen", then re-run and all tiles turn blue "cached".

Cost: ~$2.50-3.50 cold (OCR dominates), $0 warm, ~$0.05 per incremental item.

Cut first: trigram, expansion, critic LLM. Never cut: verifier, cache.
