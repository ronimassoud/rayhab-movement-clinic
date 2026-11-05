-- Phase 1 sends patients email instead of WhatsApp (PATIENT_CHANNEL=email):
-- each booking records whether the patient agreed to be emailed about it,
-- as consent_whatsapp_at does for WhatsApp.
set search_path to rayhab, public, extensions;

alter table rayhab.appointments add column if not exists consent_email_at timestamptz;
