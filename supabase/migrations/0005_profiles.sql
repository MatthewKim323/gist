-- Profiles: who is using gist. Demo-grade (no passwords): a profile is picked or created on /signin,
-- and its id rides in the signed gist_session cookie. Firm profiles carry the firm name shown to providers.
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('firm','provider')),
  display_name text not null,
  email text,
  title text,
  firm_name text,
  provider_contact_id bigint,
  avatar_color text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (role = 'firm' or provider_contact_id is not null)
);
create index if not exists profiles_role_seen_idx on profiles (role, last_seen_at desc);
create index if not exists profiles_provider_idx on profiles (provider_contact_id);
-- RLS on, no anon policies: only the service role (server) reads or writes.
alter table profiles enable row level security;
