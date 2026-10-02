-- Next moves: per-matter status for each recommended move (keys are stable, built from case data).
create table if not exists case_moves (
  matter_id bigint not null,
  move_key text not null,
  status text not null default 'todo' check (status in ('todo','in_progress','done','dismissed')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (matter_id, move_key)
);
-- RLS on, no anon policies: only the service role (server) reads or writes.
alter table case_moves enable row level security;
