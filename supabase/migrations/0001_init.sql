-- gist schema. Clio is the source of truth and is only ever read; everything here is derived.
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ---------- Clio auth + sync ----------
create table if not exists clio_tokens (
  id int primary key default 1,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists matters (
  id bigint primary key,                 -- Clio matter id
  display_number text,
  description text,
  status text,
  stage text,
  stage_updated_at timestamptz,
  practice_area text,
  client_contact_id bigint,
  client_name text,
  open_date date,
  sol_date date,
  photo_path text,                       -- storage path of the derived client photo
  raw jsonb,
  synced_at timestamptz
);

create table if not exists matter_stages (
  id bigint primary key,
  name text not null,
  ord int,
  practice_area text
);

create table if not exists sync_state (
  matter_id bigint not null,
  resource text not null,
  cursor_updated_at timestamptz,
  last_full_scan_at timestamptz,
  item_count int default 0,
  primary key (matter_id, resource)
);

-- One row per Clio item: note, email, call, task, calendar, expense, contact, relationship, custom_field, document
create table if not exists source_items (
  id text primary key,                   -- '<kind>:<clio id>' e.g. 'note:123'
  matter_id bigint not null,
  kind text not null,
  clio_id bigint not null,
  title text,
  body_text text,
  occurred_at timestamptz,
  updated_at_clio timestamptz,
  raw jsonb,
  content_hash text not null,
  first_seen_at timestamptz default now(),
  content_changed_at timestamptz default now(),
  deleted_at timestamptz,
  clio_url text
);
create index if not exists source_items_matter_kind on source_items (matter_id, kind);

create table if not exists documents (
  clio_id bigint primary key,
  matter_id bigint not null,
  name text,
  filename text,
  folder text,
  content_type text,
  size bigint,
  version_id bigint,
  received_at timestamptz,
  storage_path text,
  page_count int,
  text_layer_pages int,
  ocr_status text default 'pending',     -- pending|running|done|failed
  updated_at timestamptz default now()
);

create table if not exists doc_pages (
  doc_id bigint not null,
  version_id bigint not null,
  page int not null,
  text text,
  source text,                           -- text_layer|ocr
  ocr_model text,
  page_type text,                        -- medical_record|bill|police_report|pleading|correspondence|id|other
  has_diagnosis boolean default false,
  confidence real,
  created_at timestamptz default now(),
  primary key (doc_id, version_id, page)
);

-- ---------- extraction ----------
create table if not exists facts (
  id uuid primary key default gen_random_uuid(),
  matter_id bigint not null,
  source_ref text not null,              -- 'note:123' | 'email:88' | 'doc:45#p17'
  kind text not null,                    -- see lib/types.ts FactKind
  event_key text,                        -- canonical key used to cluster facts about the same thing
  summary text not null,
  event_date date,
  amount_usd numeric,
  quote text not null,
  quote_verified boolean default false,
  quote_score real,
  char_start int,
  importance int default 3,
  audience text default 'internal_only', -- internal_only|provider_safe
  provider_contact_id bigint,            -- set when the fact is about one provider
  jev_support text,                      -- supports|contradicts|unsupported
  jev_confidence real,
  status text default 'pending',         -- pending|verified|rejected|needs_review
  reject_reason text,
  extraction_key text not null,
  created_at timestamptz default now(),
  superseded_at timestamptz
);
create index if not exists facts_matter on facts (matter_id, status);
create index if not exists facts_event_key on facts (matter_id, event_key);

create table if not exists extraction_cache (
  cache_key text primary key,            -- sha256(shard content)+prompt_version+model
  output jsonb not null,
  created_at timestamptz default now()
);

-- ---------- retrieval ----------
create table if not exists chunks (
  id bigserial primary key,
  matter_id bigint not null,
  source_kind text not null,             -- note|email|call|task|calendar|doc_page|fact
  source_id text not null,
  page int,
  part int not null default 0,
  cite text generated always as (source_kind || ':' || source_id || coalesce('#p' || page, '')) stored,
  event_date date,
  audience text not null default 'firm', -- firm|provider_ok
  header text not null default '',
  body text not null,
  content_hash text not null,
  embedding halfvec(1536),
  fts tsvector generated always as (
    setweight(to_tsvector('english', header), 'A') ||
    setweight(to_tsvector('english', body), 'B')) stored,
  unique (matter_id, source_kind, source_id, page, part)
);
create index if not exists chunks_fts on chunks using gin (fts);
create index if not exists chunks_trgm on chunks using gin (body gin_trgm_ops);
create index if not exists chunks_matter_kind on chunks (matter_id, source_kind);

create or replace function or_tsquery(q text) returns tsquery language sql immutable as $$
  select nullif(replace(plainto_tsquery('english', q)::text, '&', '|'), '')::tsquery
$$;

create or replace function hybrid_search(
  p_matter bigint, q_text text, q_embs text[],
  match_count int default 20,
  kinds text[] default null,
  audiences text[] default array['firm','provider_ok'],
  rrf_k int default 60, fact_boost float default 1.5
) returns table (id bigint, cite text, source_kind text, header text, body text, event_date date, score float)
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
    select b.id, row_number() over (partition by e.i order by b.embedding <=> e.v::halfvec(1536)) r
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

-- ---------- reconciliation + synthesis ----------
create table if not exists contradictions (
  id uuid primary key default gen_random_uuid(),
  matter_id bigint not null,
  event_key text,
  title text not null,
  why_it_matters text,
  severity text default 'medium',        -- low|medium|high
  claims jsonb not null,                 -- [{fact_id, source_ref, says, quote}]
  created_at timestamptz default now(),
  run_id uuid
);

create table if not exists gate_items (
  id uuid primary key default gen_random_uuid(),
  matter_id bigint not null,
  phase text not null,                   -- the phase this requirement gates exit from
  requirement_key text not null,
  label text not null,
  status text not null,                  -- have|partial|missing|conflicting
  owed_by text,                          -- client|provider|defense|carrier|firm|court
  owed_by_contact_id bigint,
  due_date date,
  evidence jsonb default '[]',           -- [{source_ref, quote, fact_id}]
  note text,
  confidence real,
  updated_at timestamptz default now(),
  unique (matter_id, requirement_key)
);

create table if not exists digests (
  id bigserial primary key,
  matter_id bigint not null,
  version int not null,
  input_hash text not null,
  json jsonb not null,
  model text,
  created_at timestamptz default now(),
  unique (matter_id, version)
);

create table if not exists matter_views (
  viewer text not null,
  matter_id bigint not null,
  last_opened_at timestamptz,
  digest_version_seen int,
  primary key (viewer, matter_id)
);

-- ---------- swarm / pipeline ----------
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  matter_id bigint,
  status text default 'running',         -- running|done|failed
  started_at timestamptz default now(),
  finished_at timestamptz,
  cost_usd numeric default 0,
  stats jsonb default '{}'
);

create table if not exists agent_tasks (
  id bigserial primary key,
  run_id uuid references agent_runs on delete cascade,
  role text not null,                    -- sync|ocr|extract|verify|jev|embed|reconcile|gate|synth
  shard_label text,
  input_ref jsonb,
  cache_key text,
  status text default 'queued',          -- queued|running|done|cached|failed
  attempts int default 0,
  worker text,
  started_at timestamptz,
  finished_at timestamptz,
  tokens_in int default 0,
  tokens_out int default 0,
  cost_usd numeric default 0,
  facts_emitted int default 0,
  last_event text,
  created_at timestamptz default now()
);
create index if not exists agent_tasks_run on agent_tasks (run_id, role, status);

create table if not exists llm_calls (
  id bigserial primary key,
  matter_id bigint,
  run_id uuid,
  purpose text,
  provider text,                         -- openai|typesafe
  model text,
  input_tokens int,
  output_tokens int,
  cached_tokens int,
  cost_usd numeric,
  latency_ms int,
  created_at timestamptz default now()
);

-- ---------- provider shares ----------
create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  matter_id bigint not null,
  provider_contact_id bigint,
  provider_name text,
  token_hash text not null unique,
  config jsonb not null default '{}',    -- {sections:{...}, fact_overrides:{id:bool}, redact_terms:[]}
  created_by text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists share_views (
  id bigserial primary key,
  share_id uuid references shares on delete cascade,
  viewed_at timestamptz default now(),
  ip_hash text,
  user_agent text
);

create table if not exists share_notifications (
  id bigserial primary key,
  share_id uuid references shares on delete cascade,
  kind text,
  message text,
  created_at timestamptz default now()
);

-- realtime for live UI (pipeline timeline, share-opened toast)
do $$ begin
  begin alter publication supabase_realtime add table agent_tasks; exception when others then null; end;
  begin alter publication supabase_realtime add table agent_runs; exception when others then null; end;
  begin alter publication supabase_realtime add table share_views; exception when others then null; end;
  begin alter publication supabase_realtime add table facts; exception when others then null; end;
end $$;

-- storage bucket for downloaded Clio documents + derived images
insert into storage.buckets (id, name, public) values ('docs', 'docs', false)
on conflict (id) do nothing;

-- ---------- RLS ----------
-- All case data is read/written server-side with the service role. The anon key (shipped to the
-- browser) can only read pipeline progress and share-view pings, which carry no case content.
do $$ declare t text; begin
  foreach t in array array['clio_tokens','matters','matter_stages','sync_state','source_items','documents',
    'doc_pages','facts','extraction_cache','chunks','contradictions','gate_items','digests','matter_views',
    'agent_runs','agent_tasks','llm_calls','shares','share_views','share_notifications'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
drop policy if exists anon_read_runs on agent_runs;
create policy anon_read_runs on agent_runs for select to anon using (true);
drop policy if exists anon_read_tasks on agent_tasks;
create policy anon_read_tasks on agent_tasks for select to anon using (true);
drop policy if exists anon_read_share_views on share_views;
create policy anon_read_share_views on share_views for select to anon using (true);
