-- Run once per Supabase project (production, then staging), in the
-- dashboard's SQL Editor, before the first deploy.
--
-- 1. Replace CHOOSE-A-LONG-RANDOM-PASSWORD below with a new password (letters
--    and digits only keeps it simple in a URL), and keep it in your
--    password manager: it goes into DATABASE_URL.
-- 2. Run.
--
-- It creates the API's own database role, which can read and write the
-- booking tables but not change their structure, and turns on the
-- extension that makes double booking impossible. The tables themselves
-- are created by the first deploy (api/migrations), in a private schema,
-- "rayhab", that Supabase's Data API does not expose.

create extension if not exists btree_gist with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rayhab_app') then
    create role rayhab_app login password 'CHOOSE-A-LONG-RANDOM-PASSWORD';
  end if;
end $$;

grant usage on schema extensions to rayhab_app;

-- Check: one row, rayhab_app, able to log in.
select rolname, rolcanlogin from pg_roles where rolname = 'rayhab_app';
