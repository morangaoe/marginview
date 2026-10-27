-- Run after 012_magic_links.sql. Idempotent.
-- Supabase exposes every table in the public schema through its REST API using the anon/authenticated
-- keys. This app never uses that API (the API server connects as the postgres role, which bypasses RLS),
-- so enable RLS with no policies: the REST API sees nothing, the app is unaffected.
begin;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

commit;
