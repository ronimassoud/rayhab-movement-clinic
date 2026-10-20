-- When each background job last finished, so an uptime monitor can tell a
-- stopped worker from a quiet one (GET /api/health/worker).
set search_path to rayhab, public, extensions;

create table if not exists rayhab.heartbeats (
  name  text primary key,
  at    timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rayhab_app') then
    grant select, insert, update, delete on rayhab.heartbeats to rayhab_app;
  end if;
end $$;
