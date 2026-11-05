<?php
/* Messages, written to the outbox in the same transaction as the change
   that causes them; delivered right after the response, and by the cron
   worker as a backstop (Worker.php).

   Patients hear from the clinic on one channel, PATIENT_CHANNEL: email in
   phase 1 (PatientMail), WhatsApp in phase 2; only with that channel's
   consent. A link token in a message is stored sealed and removed once
   sent, so the outbox never holds a working link in the clear. */
declare(strict_types=1);

namespace Rayhab;

final class Notify
{
    /* The WhatsApp templates to submit to Meta (exact wording in the runbook).
       Parameters are positional: {{1}}, {{2}}, … No message names the
       service: "Scoliosis assessment" next to a phone number would tell Meta
       about the patient's health. The service shows on the private payment
       page and in the admin only. */
    public const TEMPLATES = [
        'request_received' => 'rayhab_request_received',      // day, time
        'approved' => 'rayhab_approved_choose_payment',        // day, time; URL button: the link
        'declined' => 'rayhab_request_declined',               // reason
        'new_time' => 'rayhab_new_time_proposed',              // new day, new time; URL button
        'cancelled' => 'rayhab_appointment_cancelled',         // day, time
        'payment_received' => 'rayhab_payment_received',       // amount, day
        'reminder' => 'rayhab_appointment_reminder',           // day, time, place
    ];

    public function __construct(private Db $db, private Config $cfg) {}

    /* A message to the patient, on the channel PATIENT_CHANNEL names: email
       in phase 1, WhatsApp once Meta has approved the templates. Either way
       only with that channel's consent from the booking.
       @param array{id:string,phone_e164:string,email?:?string,consent_whatsapp_at:mixed,consent_email_at?:mixed} $a */
    public function patient(array $a, string $template, array $params, ?string $linkToken = null, ?string $dedupe = null): void
    {
        if ($this->cfg->get('PATIENT_CHANNEL') === 'whatsapp') {
            $this->whatsapp($a, $template, $params, $linkToken, $dedupe);
            return;
        }
        if (empty($a['consent_email_at']) || empty($a['email'])) return;
        $mail = PatientMail::compose($this->cfg, $template, $params);
        $payload = $mail + ['reply_to' => $this->cfg->get('CLINIC_EMAIL')];
        if ($linkToken !== null) $payload['link_sealed'] = Util::seal($this->cfg->get('APP_SECRET'), $linkToken);
        $this->db->query("insert into rayhab.notification_outbox (channel, template, recipient, payload, appointment_id, dedupe_key)
                          values ('email', ?, ?, ?::jsonb, ?, ?) on conflict (dedupe_key) do nothing",
                         [$template, $a['email'], json_encode($payload, JSON_UNESCAPED_UNICODE), $a['id'], $dedupe]);
    }

    /** @param array{id:string,phone_e164:string,consent_whatsapp_at:mixed} $a */
    public function whatsapp(array $a, string $template, array $params, ?string $linkToken = null, ?string $dedupe = null): void
    {
        if (empty($a['consent_whatsapp_at'])) return;
        $payload = ['params' => array_values($params)];
        if ($linkToken !== null) $payload['link_sealed'] = Util::seal($this->cfg->get('APP_SECRET'), $linkToken);
        $this->db->query("insert into rayhab.notification_outbox (channel, template, recipient, payload, appointment_id, dedupe_key)
                          values ('whatsapp', ?, ?, ?::jsonb, ?, ?) on conflict (dedupe_key) do nothing",
                         [$template, $a['phone_e164'], json_encode($payload, JSON_UNESCAPED_UNICODE), $a['id'], $dedupe]);
    }

    /* Staff email: a reference and a link to the admin. Patient details stay behind the sign-in. */
    public function staff(string $template, string $subject, string $text, ?string $appointmentId = null, ?string $dedupe = null): void
    {
        foreach ($this->cfg->staffEmails as $to) {
            $this->db->query("insert into rayhab.notification_outbox (channel, template, recipient, payload, appointment_id, dedupe_key)
                              values ('email', ?, ?, ?::jsonb, ?, ?) on conflict (dedupe_key) do nothing",
                             [$template, $to, json_encode(['subject' => $subject, 'text' => $text], JSON_UNESCAPED_UNICODE),
                              $appointmentId, $dedupe ? $dedupe . ':' . $to : null]);
        }
    }

    public function adminUrl(string $hash): string { return rtrim($this->cfg->get('PUBLIC_ORIGIN'), '/') . '/admin/' . $hash; }

    /* The row a message needs, for one appointment. */
    public function row(string $appointmentId): ?array
    {
        return $this->db->one('select a.id, a.reference, a.local_date, a.local_time, a.mode, a.consent_whatsapp_at, a.consent_email_at, a.starts_at,
                                      s.name as service_name, p.phone_e164, p.email
                                 from rayhab.appointments a join rayhab.services s on s.id = a.service_id
                                 join rayhab.patients p on p.id = a.patient_id where a.id = ?', [$appointmentId]);
    }
}
