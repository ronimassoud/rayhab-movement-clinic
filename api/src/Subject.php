<?php
/* One person's data, for access and erasure requests (bin/subject.php).
   A person is found by phone number, email, or both; each booking created a
   patient record of its own, so one person can have several.

   Erasing removes:
     - requests that never became appointments, completely (Retention);
     - every website question from that phone or email;
     - every message record to that phone or email, or about their bookings;
   and, for appointments that happened or were paid (clinical and financial
   records the law may require the clinic to keep), keeps the booking with
   its date, service and payments, but erases the name, phone, email, note,
   the raw payment provider data, and revokes any open payment link.

   It refuses while the person has an upcoming appointment: cancel that in
   the admin first. Checking who is asking is up to the clinic (runbook,
   "Requests about personal data"). */
declare(strict_types=1);

namespace Rayhab;

final class Subject
{
    private string $digits;
    private string $email;

    public function __construct(private Db $db, string $phone = '', string $email = '')
    {
        $this->digits = (string) preg_replace('/\D/', '', $phone);
        $this->email = strtolower(trim($email));
        if (strlen($this->digits) < 8 && !filter_var($this->email, FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException('Give a phone number (with country code) or an email address.');
        }
    }

    private function patientIds(Db $db): array
    {
        return array_column($db->query("select id from rayhab.patients
                                        where (? <> '' and regexp_replace(phone_e164, '\\D', '', 'g') = ?)
                                           or (? <> '' and lower(email) = ?)",
                                       [$this->digits, $this->digits, $this->email, $this->email]), 'id');
    }

    private const ENQUIRY_MATCH = "((? <> '' and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ?) or (? <> '' and lower(email) = ?))";
    private function enquiryArgs(): array { return [$this->digits, $this->digits, $this->email, $this->email]; }

    /** Everything held about the person, for an access request. */
    public function export(): array
    {
        $pids = $this->patientIds($this->db);
        $appts = $pids ? $this->db->query("select a.id, a.reference, s.name as service, a.mode, a.for_whom, a.local_date, a.local_time, a.status,
                                                  a.note, a.consent_storage_at, a.consent_whatsapp_at, a.consent_version, a.created_at,
                                                  pi.method as payment_method, pi.status as payment_status, pi.amount, pi.currency
                                           from rayhab.appointments a join rayhab.services s on s.id = a.service_id
                                           left join rayhab.payment_intents pi on pi.appointment_id = a.id
                                           where a.patient_id = any(?::uuid[]) order by a.created_at", [$pids]) : [];
        $apptIds = array_column($appts, 'id');
        return [
            'generated_at' => gmdate('c'),
            'patients' => $pids ? $this->db->query('select first_name, last_name, phone_e164, email, created_at from rayhab.patients
                                                     where id = any(?::uuid[]) order by created_at', [$pids]) : [],
            'appointments' => $appts,
            'questions' => $this->db->query('select first_name, last_name, email, phone, message, created_at, handled_at from rayhab.enquiries
                                             where ' . self::ENQUIRY_MATCH . ' order by created_at', $this->enquiryArgs()),
            'messages' => $this->db->query("select channel, template, recipient, status, created_at, sent_at from rayhab.notification_outbox
                                            where appointment_id = any(?::text[]) or recipient = ? or lower(recipient) = ?
                                            order by created_at", [$apptIds, '+' . $this->digits, $this->email]),
        ];
    }

    /** What erasing would do, without doing it. */
    public function plan(): array
    {
        $pids = $this->patientIds($this->db);
        $count = fn(string $sql, array $args) => (int) $this->db->one($sql, $args)['n'];
        return [
            'patient_records' => count($pids),
            'requests_deleted' => $pids ? $count('select count(*)::int as n from rayhab.appointments a where a.patient_id = any(?::uuid[])
                                                  and a.status in (\'declined\', \'expired\', \'cancelled\') and ' . Retention::NEVER_HAPPENED, [$pids]) : 0,
            'appointments_kept_anonymized' => $pids ? $count('select count(*)::int as n from rayhab.appointments a where a.patient_id = any(?::uuid[])
                                                              and not (a.status in (\'declined\', \'expired\', \'cancelled\') and ' . Retention::NEVER_HAPPENED . ')', [$pids]) : 0,
            'upcoming' => $pids ? $count("select count(*)::int as n from rayhab.appointments a where a.patient_id = any(?::uuid[])
                                          and a.status in ('requested', 'approved', 'confirmed', 'reschedule_requested') and a.starts_at > now()", [$pids]) : 0,
            'questions_deleted' => $count('select count(*)::int as n from rayhab.enquiries where ' . self::ENQUIRY_MATCH, $this->enquiryArgs()),
        ];
    }

    /** Erases the person, in one transaction. @return array the plan that was carried out */
    public function erase(): array
    {
        return $this->db->tx(function (Db $t): array {
            $plan = $this->plan();
            if ($plan['upcoming'] > 0) {
                throw new \RuntimeException($plan['upcoming'] . ' upcoming appointment(s): cancel them in the admin first, then erase.');
            }
            $pids = $this->patientIds($t);
            if ($pids) {
                $gone = $t->query("select a.id, a.patient_id from rayhab.appointments a where a.patient_id = any(?::uuid[])
                                   and a.status in ('declined', 'expired', 'cancelled') and " . Retention::NEVER_HAPPENED, [$pids]);
                Retention::deleteRequests($t, $gone);
                $kept = array_column($t->query('select id from rayhab.appointments where patient_id = any(?::uuid[])', [$pids]), 'id');
                if ($kept) {
                    $t->query("update rayhab.appointments set note = '', updated_at = now() where id = any(?::text[])", [$kept]);
                    $t->query("update rayhab.events set actor_name = '', actor_id = null where appointment_id = any(?::text[]) and actor_kind = 'patient'", [$kept]);
                    $t->query('delete from rayhab.notification_outbox where appointment_id = any(?::text[])', [$kept]);
                    $t->query('update rayhab.payment_links set revoked_at = coalesce(revoked_at, now()) where appointment_id = any(?::text[])', [$kept]);
                    $t->query('update rayhab.payment_transactions set raw = null, checkout_url = null
                               where intent_id in (select id from rayhab.payment_intents where appointment_id = any(?::text[]))', [$kept]);
                }
                $t->query("update rayhab.patients set first_name = 'Erased', last_name = '', phone_e164 = '', email = null, updated_at = now()
                           where id = any(?::uuid[])", [$pids]);
            }
            $t->query('delete from rayhab.enquiries where ' . self::ENQUIRY_MATCH, $this->enquiryArgs());
            if ($this->digits !== '') $t->query('delete from rayhab.notification_outbox where recipient = ?', ['+' . $this->digits]);
            if ($this->email !== '') $t->query('delete from rayhab.notification_outbox where lower(recipient) = ?', [$this->email]);
            Records::log($t, 'subject_erased', null, ['kind' => 'system', 'name' => 'Data request'],
                sprintf('Erased on request: %d request(s) deleted, %d appointment(s) kept without personal details, %d question(s) deleted',
                        $plan['requests_deleted'], $plan['appointments_kept_anonymized'], $plan['questions_deleted']));
            return $plan;
        });
    }
}
