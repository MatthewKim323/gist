-- Provider responses: a provider office answers a "what the firm needs" item with a file and/or a note.
-- Stored with gist only (files in the 'docs' bucket under <matter_id>/submissions/). Nothing is written to Clio.
create table if not exists provider_submissions (
  id uuid primary key default gen_random_uuid(),
  matter_id bigint not null,
  provider_contact_id bigint not null,
  provider_name text,
  share_id uuid null references shares(id) on delete set null,
  gate_requirement_key text null,
  item_label text,
  kind text not null default 'record' check (kind in ('record','bill','note')),
  note text,
  file_path text null,
  file_name text,
  size bigint,
  content_type text,
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null
);
create index if not exists provider_submissions_matter_idx on provider_submissions (matter_id, created_at desc);
create index if not exists provider_submissions_provider_idx on provider_submissions (matter_id, provider_contact_id);
-- RLS on, no anon policies: only the service role (server) reads or writes.
alter table provider_submissions enable row level security;
