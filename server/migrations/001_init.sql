-- Rayhab booking database, first version.
--
-- Everything lives in the private schema "rayhab". Supabase's Data API only
-- exposes the schemas listed in its settings (public by default), so these
-- tables are reachable only by the API's own database role, never from a
-- browser. Times are stored as instants (timestamptz, UTC); the Beirut
-- calendar day and wall time are stored beside them as text, because that
-- is how the clinic and the patient read them.

-- Supabase keeps extensions in their own schema; create it elsewhere too.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists rayhab;
set search_path to rayhab, public, extensions;

create sequence rayhab.reference_seq start 1041;

create table rayhab.practitioners (
  id            text primary key,
  auth_user_id  uuid unique,                   -- the Supabase Auth user, for staff sign-in
  name          text not null,
  title         text not null default '',
  email         text,
  role          text not null default 'practitioner' check (role in ('admin', 'practitioner', 'reception')),
  bookable      boolean not null default true, -- appears to patients
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table rayhab.services (
  id            text primary key,
  name          text not null,
  description   text not null default '',
  tag           text not null default '',
  duration_min  integer not null check (duration_min between 10 and 240),
  buffer_min    integer not null default 0 check (buffer_min between 0 and 120),
  price_amount  integer check (price_amount >= 0),   -- minor units for USD, whole pounds for LBP
  currency      text not null default 'USD' check (currency in ('USD', 'LBP')),
  modes         text[] not null default array['clinic', 'online'],
  sort          integer not null default 0,
  active        boolean not null default true
);

create table rayhab.service_practitioners (
  service_id      text not null references rayhab.services(id) on delete cascade,
  practitioner_id text not null references rayhab.practitioners(id) on delete cascade,
  primary key (service_id, practitioner_id)
);

create table rayhab.working_hours (
  id              bigint generated always as identity primary key,
  practitioner_id text not null references rayhab.practitioners(id) on delete cascade,
  weekday         smallint not null check (weekday between 0 and 6),   -- 0 Sunday
  start_time      text not null check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time        text not null check (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  check (end_time > start_time)
);

create table rayhab.schedule_exceptions (
  id              text primary key,
  practitioner_id text not null references rayhab.practitioners(id) on delete cascade,
  local_date      text not null check (local_date ~ '^\d{4}-\d{2}-\d{2}$'),
  start_time      text not null check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time        text not null check (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  reason          text not null default '',
  created_by      text references rayhab.practitioners(id),
  created_at      timestamptz not null default now(),
  check (end_time > start_time)
);
create index on rayhab.schedule_exceptions (local_date);

create table rayhab.patients (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null,
  phone_e164  text not null,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on rayhab.patients (phone_e164);

create table rayhab.appointments (
  id                   text primary key,
  reference            text not null unique,
  patient_id           uuid not null references rayhab.patients(id),
  practitioner_id      text not null references rayhab.practitioners(id),
  service_id           text not null references rayhab.services(id),
  mode                 text not null check (mode in ('clinic', 'online')),
  for_whom             text not null check (for_whom in ('me', 'child')),
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  local_date           text not null check (local_date ~ '^\d{4}-\d{2}-\d{2}$'),
  local_time           text not null check (local_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  status               text not null check (status in ('requested', 'approved', 'confirmed', 'completed',
                         'declined', 'cancelled', 'expired', 'no_show', 'reschedule_requested')),
  note                 text not null default '',          -- may hold health information
  hold_expires_at      timestamptz,
  consent_storage_at   timestamptz not null,
  consent_whatsapp_at  timestamptz,
  consent_version      text not null,
  financial_closed_at  timestamptz,
  reminded_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Two live appointments for one practitioner can never overlap. This is
  -- the final guard against double booking, whatever the application does.
  constraint appointments_no_overlap exclude using gist (
    practitioner_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('requested', 'approved', 'confirmed', 'reschedule_requested'))
);
create index on rayhab.appointments (local_date);
create index on rayhab.appointments (status);
create index on rayhab.appointments (created_at);

create table rayhab.payment_intents (
  id              text primary key,
  appointment_id  text not null unique references rayhab.appointments(id) on delete cascade,
  method          text check (method in ('whish', 'cash')),
  status          text not null default 'not_selected'
                    check (status in ('not_selected', 'awaiting_payment', 'paid', 'refunded')),
  amount          integer not null check (amount >= 0),
  currency        text not null check (currency in ('USD', 'LBP')),
  outstanding     integer not null check (outstanding >= 0),
  updated_at      timestamptz not null default now()
);

create table rayhab.payment_transactions (
  id            text primary key,
  intent_id     text not null references rayhab.payment_intents(id) on delete cascade,
  provider      text not null check (provider in ('whish', 'cash')),
  status        text not null check (status in ('pending', 'verified', 'failed', 'abandoned')),
  amount        integer not null check (amount >= 0),
  currency      text not null,
  external_ref  text unique,              -- Whish's own reference; unique, so a callback counts once
  reference     text,                     -- receipt number shown to staff and patient
  recorded_by   text references rayhab.practitioners(id),
  checkout_url  text,
  raw           jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on rayhab.payment_transactions (intent_id);
create index on rayhab.payment_transactions (status) where status = 'pending';

-- The secure link a patient receives by WhatsApp. Only a hash of the token
-- is kept, so a database leak does not leak working links.
create table rayhab.payment_links (
  token_hash      text primary key,
  appointment_id  text not null references rayhab.appointments(id) on delete cascade,
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);
create index on rayhab.payment_links (appointment_id);

create table rayhab.enquiries (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null,
  email       text not null,
  phone       text,
  message     text not null,                  -- may hold health information
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

-- Everything that happened, for the admin's history and the audit trail.
create table rayhab.events (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  type            text not null,
  appointment_id  text references rayhab.appointments(id) on delete set null,
  actor_kind      text not null check (actor_kind in ('staff', 'patient', 'system')),
  actor_id        text,
  actor_name      text not null default '',
  summary         text not null default '',
  old_status      text,
  new_status      text,
  request_id      text
);
create index on rayhab.events (appointment_id);
create index on rayhab.events (at desc);

-- Messages to send, written in the same transaction as the change that
-- causes them, and delivered by the worker.
create table rayhab.notification_outbox (
  id                   bigint generated always as identity primary key,
  channel              text not null check (channel in ('whatsapp', 'email')),
  template             text not null,
  recipient            text not null,
  payload              jsonb not null default '{}',
  appointment_id       text references rayhab.appointments(id) on delete set null,
  dedupe_key           text unique,
  status               text not null default 'pending'
                         check (status in ('pending', 'sending', 'sent', 'failed', 'dead', 'skipped')),
  attempts             integer not null default 0,
  next_attempt_at      timestamptz not null default now(),
  last_error           text,
  provider_message_id  text,
  delivery_status      text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz
);
create index on rayhab.notification_outbox (status, next_attempt_at);
create index on rayhab.notification_outbox (provider_message_id);

create table rayhab.idempotency_keys (
  scope         text not null,
  key           text not null,
  request_hash  text not null,
  status_code   integer,
  response      jsonb,
  created_at    timestamptz not null default now(),
  primary key (scope, key)
);

create table rayhab.staff_sessions (
  id_hash          text primary key,
  practitioner_id  text not null references rayhab.practitioners(id) on delete cascade,
  csrf_token       text not null,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  user_agent       text
);

-- Between the password and the authenticator code: the identity provider's
-- first-step token, encrypted, for five minutes.
create table rayhab.auth_pending (
  id_hash      text primary key,
  sealed       text not null,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

-- The API's own database role, if the runbook has created it, may read and
-- write the tables but not change the schema.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rayhab_app') then
    grant usage on schema rayhab to rayhab_app;
    grant select, insert, update, delete on all tables in schema rayhab to rayhab_app;
    grant usage, select on all sequences in schema rayhab to rayhab_app;
    alter default privileges in schema rayhab grant select, insert, update, delete on tables to rayhab_app;
    alter default privileges in schema rayhab grant usage, select on sequences to rayhab_app;
  end if;
end $$;
