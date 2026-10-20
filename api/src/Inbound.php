<?php
/* Messages patients send to the clinic's WhatsApp sending number, from the
   webhook (Routes/Webhooks.php). That number is the booking system's own
   (runbook step 6, option B): nobody reads it in an app, so:

     STOP, and the same in Arabic and French: WhatsApp is turned off for that
       number, as the WhatsApp Business policy requires; messages still queued
       to it are dropped, and staff are told by email (a reference, no text).
     Anything else: it becomes an enquiry in the admin, linked to the
       patient's latest booking, to answer from the clinic's main WhatsApp.
       The staff email says only that a reply arrived, never what it says:
       it may describe the patient's health, and email goes through Resend.

   Photos, voice notes and documents are not downloaded or kept; the admin
   shows that one arrived. A booking made later asks for WhatsApp consent
   again, so a new tick turns messages back on for that booking. */
declare(strict_types=1);

namespace Rayhab;

final class Inbound
{
    /* Whole-message matches only, so "please don't stop my reminders" is a reply. */
    private const STOP_WORDS = ['stop', 'unsubscribe', 'stop messages', 'stop all', 'arret', 'arrêt', 'stop whatsapp',
                                'توقف', 'إيقاف', 'ايقاف', 'الغاء الاشتراك', 'إلغاء الاشتراك'];

    public function __construct(private Db $db, private Notify $notify) {}

    /** One message object from the webhook's "messages" list. @return string what was done */
    public function handle(array $m, ?string $profileName): string
    {
        $from = (string) preg_replace('/\D/', '', (string) ($m['from'] ?? ''));
        $id = (string) ($m['id'] ?? '');
        if (strlen($from) < 8 || $id === '') return 'ignored';
        if ($this->db->one('select 1 as x from rayhab.enquiries where source_message_id = ?', [$id])) return 'duplicate';

        $text = self::text($m);
        $latest = $this->db->one("select a.id, a.reference, p.first_name, p.last_name from rayhab.appointments a
                                    join rayhab.patients p on p.id = a.patient_id
                                   where regexp_replace(p.phone_e164, '\\D', '', 'g') = ? order by a.created_at desc limit 1", [$from]);

        if (self::isStop($text)) return $this->optOut($from, $id, $latest);

        [$first, $last] = $latest ? [$latest['first_name'], $latest['last_name']] : self::splitName($profileName ?? '');
        $this->db->tx(function (Db $t) use ($from, $id, $text, $latest, $first, $last) {
            $t->query("insert into rayhab.enquiries (first_name, last_name, email, phone, message, channel, appointment_id, source_message_id)
                       values (?, ?, null, ?, ?, 'whatsapp', ?, ?) on conflict (source_message_id) do nothing",
                      [$first ?: 'WhatsApp', $last, '+' . $from, $text, $latest['id'] ?? null, $id]);
            $this->notify->staff('whatsapp_reply', 'A patient replied on WhatsApp' . ($latest ? ' (' . $latest['reference'] . ')' : ''),
                "A patient replied to one of the clinic's WhatsApp messages. Read it and answer it from the clinic's main WhatsApp: "
                . $this->notify->adminUrl('#/enquiries') . "\n", null, 'wa-reply:' . $id);
        });
        return 'reply';
    }

    private function optOut(string $from, string $id, ?array $latest): string
    {
        $this->db->tx(function (Db $t) use ($from, $id, $latest) {
            $t->query("update rayhab.appointments a set consent_whatsapp_at = null, updated_at = now()
                         from rayhab.patients p where p.id = a.patient_id and a.consent_whatsapp_at is not null
                          and regexp_replace(p.phone_e164, '\\D', '', 'g') = ?", [$from]);
            $t->query("update rayhab.notification_outbox set status = 'skipped', last_error = 'The patient asked to stop WhatsApp messages'
                        where channel = 'whatsapp' and status in ('pending', 'failed') and regexp_replace(recipient, '\\D', '', 'g') = ?", [$from]);
            Records::log($t, 'whatsapp_opt_out', $latest['id'] ?? null, ['kind' => 'patient', 'name' => 'Patient'], 'Asked to stop WhatsApp messages');
            $this->notify->staff('whatsapp_opt_out', 'A patient turned off WhatsApp messages' . ($latest ? ' (' . $latest['reference'] . ')' : ''),
                "A patient replied STOP to the clinic's WhatsApp messages, so the booking system will not message them on WhatsApp again"
                . " unless they tick WhatsApp consent on a new booking.\n\nIf you still need to reach them about an appointment, call them. "
                . $this->notify->adminUrl('#/requests') . "\n", null, 'wa-stop:' . $id);
        });
        return 'opted_out';
    }

    public static function isStop(string $text): bool
    {
        $t = mb_strtolower(trim((string) preg_replace('/[\s\p{P}]+/u', ' ', $text)));
        return in_array($t, self::STOP_WORDS, true);
    }

    /** What the admin shows for each kind of message. */
    public static function text(array $m): string
    {
        $type = (string) ($m['type'] ?? '');
        $body = match ($type) {
            'text' => (string) ($m['text']['body'] ?? ''),
            'button' => (string) ($m['button']['text'] ?? ''),
            'interactive' => (string) ($m['interactive']['button_reply']['title'] ?? $m['interactive']['list_reply']['title'] ?? ''),
            default => '',
        };
        if ($body !== '') return mb_substr($body, 0, 2000);
        $what = ['image' => 'a photo', 'audio' => 'a voice note', 'video' => 'a video', 'document' => 'a document',
                 'sticker' => 'a sticker', 'location' => 'a location', 'contacts' => 'a contact', 'reaction' => 'a reaction'][$type] ?? 'a message';
        return "[The patient sent $what on WhatsApp. It isn't kept here; ask them to send it to the clinic's main WhatsApp if it is needed.]";
    }

    /** @return array{0:string,1:string} */
    private static function splitName(string $name): array
    {
        $parts = preg_split('/\s+/', trim(mb_substr($name, 0, 80))) ?: [];
        return [(string) array_shift($parts), implode(' ', $parts)];
    }
}
