-- Patients' WhatsApp replies. The sending number is used only by the booking
-- system (runbook step 6, option B), so a reply would otherwise go unread:
-- it becomes an enquiry in the admin, next to website questions, linked to
-- the patient's latest booking. Meta's message id makes a redelivered
-- webhook count once.
set search_path to rayhab, public, extensions;

alter table rayhab.enquiries alter column email drop not null;
alter table rayhab.enquiries add column if not exists channel text not null default 'website'
  check (channel in ('website', 'whatsapp'));
alter table rayhab.enquiries add column if not exists appointment_id text references rayhab.appointments(id) on delete set null;
alter table rayhab.enquiries add column if not exists source_message_id text unique;
