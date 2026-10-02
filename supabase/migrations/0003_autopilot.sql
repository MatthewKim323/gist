-- Autopilot: gist watches Clio on a schedule, re-digests only matters that changed, and records what moved.
create table if not exists autopilot_state (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  interval_min int not null default 15,
  last_tick_at timestamptz,
  next_tick_at timestamptz,
  ticking_since timestamptz,             -- lock: set while a tick runs; stale after 10 minutes
  last_summary jsonb default '{}'
);
insert into autopilot_state (id) values (1) on conflict (id) do nothing;

create table if not exists autopilot_events (
  id bigserial primary key,
  matter_id bigint,
  kind text not null check (kind in ('stage_changed','new_items','gate_flipped','newly_overdue','new_red_flag','digest_refreshed','no_change','error')),
  title text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  run_id uuid
);
create index if not exists autopilot_events_recent on autopilot_events (created_at desc);
create index if not exists autopilot_events_matter on autopilot_events (matter_id, created_at desc);

-- RLS on, no anon policies: the UI polls through /api/autopilot (service role).
alter table autopilot_state enable row level security;
alter table autopilot_events enable row level security;
