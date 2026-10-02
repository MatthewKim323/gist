-- Demo cases: synthetic matters that live only in Supabase (never in Clio). Seeded by scripts/seed-demo.ts,
-- digested by the same pipeline as real cases, and labeled "Demo" everywhere in the UI.
alter table matters add column if not exists is_demo boolean default false;
create index if not exists matters_is_demo on matters (is_demo) where is_demo;
