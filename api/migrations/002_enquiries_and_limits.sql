-- The admin's Enquiries view: who marked a website question answered.
-- And the API's own rate limits: Apache has no request limiter of its own,
-- so the counts live here, in fixed windows.
set search_path to rayhab, public, extensions;

alter table rayhab.enquiries add column if not exists handled_by text references rayhab.practitioners(id);
create index if not exists enquiries_open on rayhab.enquiries (created_at) where handled_at is null;

create table if not exists rayhab.rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, window_start)
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rayhab_app') then
    grant select, insert, update, delete on all tables in schema rayhab to rayhab_app;
    grant usage, select on all sequences in schema rayhab to rayhab_app;
  end if;
end $$;

-- A repeated request must get back exactly the first answer, byte for byte;
-- jsonb would reorder its keys, so the stored answer is plain text.
alter table rayhab.idempotency_keys alter column response type text using response::text;
