-- Agent actions: gist's agent drafts the next move for each blocking gate item; the attorney approves,
-- edits or dismisses. Nothing is ever sent automatically and nothing is written to Clio.
create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  matter_id bigint not null,
  requirement_key text not null,
  kind text not null check (kind in ('records_request','client_followup','defense_demand','carrier_followup','internal_task')),
  recipient_name text,
  recipient_contact_id bigint,
  recipient_email text null,
  channel text not null default 'email' check (channel in ('email','letter','call')),
  subject text not null default '',
  body text not null default '',
  rationale text,
  cites jsonb not null default '[]',
  covers jsonb not null default '[]',      -- every requirement_key / action id this draft answers
  status text not null default 'proposed' check (status in ('proposed','approved','dismissed','sent_manually')),
  source text not null default 'template' check (source in ('model','template')),
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (matter_id, requirement_key, kind)
);
create index if not exists agent_actions_matter_idx on agent_actions (matter_id, status);
-- RLS on, no anon policies: only the service role (server) reads or writes.
alter table agent_actions enable row level security;
alter table agent_actions add column if not exists covers jsonb not null default '[]';
