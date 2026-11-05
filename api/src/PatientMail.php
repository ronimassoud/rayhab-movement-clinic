<?php
/* The emails patients get while PATIENT_CHANNEL=email (phase 1): the same
   seven messages as the WhatsApp templates (Notify::TEMPLATES), with the
   same parameters in the same order, and just as neutral. They give a day,
   a time and a place, never the service, which would tell the email
   provider about the patient's health.

   A message that needs the private link carries {link}; the worker puts the
   real link in only at sending time (Worker::deliver), so the outbox never
   holds a working one. Replies go to CLINIC_EMAIL: the sending address only
   sends. */
declare(strict_types=1);

namespace Rayhab;

final class PatientMail
{
    public const LINK = '{link}';

    /** @return array{subject:string,text:string} */
    public static function compose(Config $cfg, string $template, array $params): array
    {
        $p = array_map('strval', array_values($params));
        $site = rtrim($cfg->get('PUBLIC_ORIGIN'), '/');
        $cashOnly = $cfg->get('WHISH_DRIVER') === 'disabled';
        [$subject, $body] = match ($template) {
            'request_received' => ['We have your appointment request',
                "Thank you for your request for an appointment on {$p[0]} at {$p[1]} (Beirut time).\n\n"
                . "This is a request, not yet a confirmed appointment. We will reply by email within one working day."],
            'approved' => ['Your appointment is approved: please confirm it',
                "Good news: your appointment on {$p[0]} at {$p[1]} (Beirut time) is approved.\n\n"
                . ($cashOnly ? "Please confirm it with this private link. You pay at the clinic when you come in:\n"
                             : "Please choose how you would like to pay with this private link:\n")
                . self::LINK . "\n\nThe link is private to you; please don't share it."],
            'declined' => ['About your appointment request',
                "We are sorry, we cannot take your appointment request. " . ($p[0] ?? '') . "\n\n"
                . "You are welcome to request another time on our website: $site/book.html"],
            'new_time' => ['A new time for your appointment',
                "The time you asked for is not available. We can offer {$p[0]} at {$p[1]} (Beirut time).\n\n"
                . "Please accept it, or ask for another time, with this private link:\n" . self::LINK],
            'cancelled' => ['Your appointment has been cancelled',
                "Your appointment on {$p[0]} at {$p[1]} has been cancelled."],
            'payment_received' => ['Payment received',
                "Thank you, we have received your payment of {$p[0]} for your appointment on {$p[1]}. See you soon."],
            'reminder' => ['Reminder: your appointment tomorrow',
                "This is a reminder that your appointment is on {$p[0]} at {$p[1]} (Beirut time), {$p[2]}.\n\n"
                . "Wear clothes you can move in, and bring any X-ray or report you have."],
            default => throw new \InvalidArgumentException("No patient email for $template"),
        };
        return [
            'subject' => 'Rayhab: ' . $subject,
            'text' => "Hello,\n\n$body\n\n"
                . "Questions? Reply to this email, or message us on WhatsApp at " . $cfg->get('CLINIC_PHONE') . ".\n\n"
                . $cfg->get('CLINIC_NAME') . "\n$site\n\n"
                . "You are receiving this because you requested an appointment on our website.\n",
        ];
    }
}
