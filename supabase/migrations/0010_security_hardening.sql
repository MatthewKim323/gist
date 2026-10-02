-- Security hardening (defense in depth on top of RLS, which is already on for every table).
--
-- Model: the browser only ever holds the anon key. Every read and write of case data happens on the server
-- with the service_role key (which bypasses RLS by design and never leaves the server). So anon and
-- authenticated get NO table privileges at all, except SELECT on the three tables the live UI subscribes to
-- over Realtime (pipeline progress counts and share-link view pings, no case content).
--
-- Apply after the demo recording (it changes grants): supabase db push / psql -f.

begin;

-- 1. Every table in public: RLS on and forced, and no direct privileges for client roles.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 2. The three Realtime-fed tables: read-only for anon, nothing else. Their RLS select policies
--    (anon_read_runs, anon_read_tasks, anon_read_share_views from 0001) stay as they are.
grant select on table public.agent_runs, public.agent_tasks, public.share_views to anon;

-- 3. Sequences: no client role can mint ids.
revoke all on all sequences in schema public from anon, authenticated;

-- 4. Functions (hybrid_search, similar_chunks, recall_memories, or_tsquery): server only. They are
--    SECURITY INVOKER so RLS already applied to callers, this removes the surface entirely.
revoke execute on all functions in schema public from anon, authenticated, public;
grant execute on all functions in schema public to service_role;

-- 5. Future objects created in public do not inherit client privileges (Supabase's default grants them).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- 6. Storage: the docs bucket (Clio documents, derived photos, provider uploads) stays private. No
--    storage.objects policies exist for anon/authenticated, so only the server (service_role) can read or
--    sign URLs for it.
update storage.buckets set public = false where id = 'docs';

commit;

-- Verify (run as anon with the public key, expect 0 rows / 401 everywhere except the three realtime tables):
--   curl "$SUPABASE_URL/rest/v1/matters?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
