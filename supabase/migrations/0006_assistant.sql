-- Ask gist: the companion assistant. Threads + messages per matter, and a per-user relationship memory
-- (what this person focuses on, how they like answers, who they ask about), embedded for recall.
-- profile_id is text: a profiles.id uuid when signed in, else a stable role key ('firm') so the demo
-- flow without sign-in still remembers. RLS on, no anon policies: only the service role touches these.

create table if not exists assistant_threads (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null,
  matter_id bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists assistant_threads_owner_idx on assistant_threads (profile_id, matter_id, created_at desc);

create table if not exists assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references assistant_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content text not null,
  cites jsonb not null default '[]'::jsonb,
  tab text,
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_thread_idx on assistant_messages (thread_id, created_at);

create table if not exists profile_memories (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null,
  matter_id bigint,
  kind text not null check (kind in ('preference','focus','fact','relationship')),
  text text not null,
  embedding halfvec(1536),
  fts tsvector generated always as (to_tsvector('english', text)) stored,
  importance int not null default 3,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists profile_memories_owner_idx on profile_memories (profile_id, created_at desc);
create index if not exists profile_memories_fts_idx on profile_memories using gin (fts);

alter table assistant_threads enable row level security;
alter table assistant_messages enable row level security;
alter table profile_memories enable row level security;

-- Recall: cosine over the profile's memories, fused with keyword rank (RRF), small boost for importance
-- and for memories scoped to the current matter. Global (matter_id null) memories always qualify.
create or replace function recall_memories(p_profile text, q_emb text, k int default 6, p_matter bigint default null, q_text text default null)
returns table (id uuid, kind text, text text, matter_id bigint, importance int, created_at timestamptz, score float)
language sql stable as $$
with base as (
  select * from profile_memories
  where profile_id = p_profile and (matter_id is null or p_matter is null or matter_id = p_matter)
),
vec as (
  select id, row_number() over (order by embedding <=> q_emb::halfvec(1536)) r
  from base where embedding is not null and q_emb is not null
),
kw as (
  select id, row_number() over (order by ts_rank_cd(fts, websearch_to_tsquery('english', q_text)) desc) r
  from base where q_text is not null and fts @@ websearch_to_tsquery('english', q_text)
),
fused as (
  select id, sum(w) s from (
    select id, 1.0 / (60 + r) w from vec
    union all select id, 1.0 / (60 + r) from kw
  ) u group by id
)
select b.id, b.kind, b.text, b.matter_id, b.importance, b.created_at,
       f.s * (1 + 0.1 * b.importance) * case when b.matter_id = p_matter then 1.2 else 1 end as score
from fused f join base b using (id)
order by score desc
limit k;
$$;
